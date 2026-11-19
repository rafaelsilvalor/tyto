# 0216 — An apply operation may answer continue, and the host asks again within one Apply

Status: accepted · 2026-11-19 · TYTO-791 · amends ADR 0170 (decision 2); builds on ADR 0042,
ADR 0129, ADR 0135 and ADR 0138

## Context

ADR 0170 decision 2 hands a plan to its verb in batches of 100 operations, one `apply` call per
batch, under the 30 s deadline every isolated plugin call has (ADR 0042). An operation answers
`applied`, `failed` or `skipped`, and the host never calls `apply` again for it.

TYTO-759 (`google.drive-upload`, in the Google plugin's own repository) uploads a delivery's
editable files to a shared drive. A 100 MB file at 10 Mbps takes about 80 s, an estimate rather
than a measurement: no single call holds it. The plugin ships with a resumable session kept in
its cache (ADR 0138) and the instruction "run the cell and Apply again until it finishes", so a
person presses Apply four or five times. TYTO-758 ships a delivery as one plan and needs one
Apply.

Two shapes were open:

- **A longer deadline for actions that declare it.** One call holds the whole upload. It shows no
  progress until it ends, a cancel cannot land between parts, and a dead network holds the call
  for the whole longer deadline. The deadline is uniform today (ADR 0042), and a per-verb one is
  a manifest field every host has to honour.
- **An answer that says "in progress, continue".** The plugin keeps working within its 30 s, says
  how far it got, and the host asks again. Every call stays short, the host has a moment between
  calls to show progress and to stop, and the deadline stays as it is.

## Decision

1. **An `apply` answer may say `continue`.** `AppliedBatchOperation.status` gains `continue`, and
   the entry an optional `progress`: one line for a person, at most **80 characters**
   (`APPLY_PROGRESS_MAX_LENGTH`), such as `sent 48 of 100 MB`. `progress` belongs to `continue`
   only; on another status, empty or over 80 characters it makes the batch unreadable, as a
   `failed` entry with no reason does. The entry carries **no new payload**: the plugin resumes
   from what it keeps in its own cache, and the host hands back the operation it planned.
2. **The host asks again, within the same Apply.** After a batch answers, the operations that
   said `continue` are handed to `apply` again, alone and in the plan's order, until each answers
   `applied`, `failed` or `skipped`. The loop is `applyPlan` in `@tyto/plugin-api`, so the
   desktop, `tyto recipe run --apply` and `tyto mcp`'s apply share it; a host adds only a cancel
   and a progress line (`ApplyOptions` in `@tyto/recipe`: `cancel`, anything with `aborted`, and
   `onProgress`).
3. **A ceiling: 120 more calls for one batch** (`APPLY_CONTINUE_CALLS`), an hour at the deadline.
   An operation still in progress after them is `failed` with the reason
   `unfinished: still in progress after 120 more calls; some may have been written`.
4. **Cancel is read between calls, never during one.** The call under way finishes or meets its
   deadline. An operation still in progress is then `failed` with the reason
   `unfinished: the Apply was cancelled; some may have been written`; a batch not yet handed over
   is `skipped` (`the Apply was cancelled before it was handed over`), and nothing is asked
   again. **No fifth outcome status**: an unfinished operation is `failed`, so its row keeps its
   old state (ADR 0170 decision 4) and the next run plans it again; a fifth status would ripple
   through `stateToCommit`, the plan's marks and `--json` for one word.
5. **A later call without a usable answer stops the Apply as a first one does**: the operations
   it carried are `failed` with `no answer; some may have been written`, and every later batch is
   `skipped` (ADR 0170 decision 2).
6. **The hosts.**
   - The desktop pushes `recipe:apply-progress` after each call that left a write in progress,
     and the plan draws "Applying: 3 of 10 done · sent 48 of 100 MB" with **Cancel** beside it.
     **Cancel** sends `recipe:apply-cancel` and reads "Stopping after this call" until the Apply
     answers.
   - `tyto recipe run --apply` prints one progress line a call on stderr. The first Ctrl+C while
     it applies cancels (the environment's `interrupt` port, installed only then); a second ends
     the process as before. A cancelled Apply applies no later plan and **exits 1**, as a failed
     operation does (ADR 0011).
   - `tyto mcp` loops the same way and shows no progress: its tool answers once.
7. **Protocol 28.** The answer schema of `isolation/points.ts` accepts `continue` and `progress`,
   which a host on 27 refuses, so `RPC_PROTOCOL_VERSION` moves from 27 to 28. The number is the
   host's and its own guest bootstrap's: **a plugin's code carries none**, so a plugin built
   before 28 runs on a host at 28 unchanged, and it never answers `continue`.

## Consequences

- One Apply finishes a long upload, and the person sees it moving and can stop it.
- **Version skew.** A plugin that answers `continue` to a host before 28 gets the outcome that
  host gives any status it does not know: the batch is `failed` with
  `no answer; some may have been written`, and later batches are `skipped`. Such a plugin writes
  `"engine": ">=0.26"`, the `@tyto/plugin-api` that carries 28, so an older host refuses to
  install it instead.
- A plugin that answers `continue` for ever holds an Apply for an hour per batch at most, and the
  person can cancel it from the first progress line.
- `apply auto` loops too, but shows no progress and takes no cancel: it runs without a person
  watching the plan.
- The Google plugin still asks for a second Apply until its upload marks its parts `continue`; that
  is its own repository's change, not this record's.
