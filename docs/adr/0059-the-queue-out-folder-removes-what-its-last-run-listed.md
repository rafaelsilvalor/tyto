# 0059 — The queue's `out/` removes what its last run listed, and nothing else

Status: accepted · 2026-09-30 · TYTO-199 · amends ADR 0054's "where it does not"

## Context

ADR 0054 made a delivery remove what Tyto wrote there last time and did not write this time,
and left the desktop's queue panel out on purpose: `outbox/<id>/out/` is the ADR 0011 contract
folder, and changing what appears there needed its own decision.

Measured on 2026-09-30 in the running app, with its own user-data folder and `TYTO_HOME`: a
queue task of four slides, then the same task with three. Both routes to a second run left
four PNGs in `out/` beside a `result.json` that listed three.

- **Try again.** A clean run moves the task to `done/`, so the button only exists after a
  failure. The failure used was the one `queue.ts` already names, a move to `done/` refused
  because a file in the task folder is open. The four slides were on disk, the brief was cut
  to three, and _Try again_ rendered it.
- **The same id dropped again** after a finished four-slide run, which is how a caller
  re-sends a task.

Two answers were on the table: reuse ADR 0054's rule, or clear `out/` before a run, since
nobody but Tyto writes there.

## Decision

**The desktop queue opens `out/` with ADR 0054's rule on.** Before a run writes anything, it
reads the `result.json` already in `out/`; after the artwork is written and before the new
`result.json` replaces it, it removes each file that report listed and this run did not
produce. Everything ADR 0054 says about what is kept applies unchanged: a file whose size is
not the recorded one, a name that is not a single file name, a run that was cancelled,
reported an error or wrote fewer files than it planned, and a removal the operating system
refuses.

Clearing `out/` was not chosen. It is a second way of deleting files, and it deletes at the
worst moment: a retry that fails again, or is cancelled, would leave `out/` with less in it
than before, where ADR 0054 keeps the older files precisely then.

**What a program reading `out/` sees change, in plain words.** After a run that removed
something, `out/` holds only the files the new `result.json` lists, plus `result.json`
itself. That `result.json` carries one `W_LEFTOVER_REMOVED` warning per file removed and one
`W_LEFTOVER_KEPT` per listed file that stayed, with the reason. Both are warnings: `status`
stays `ok` when nothing else went wrong. A new diagnostic code is not a breaking change under
the render contract (`docs/render-contract.md`), and a reader that already goes by
`result.json`'s `artifacts[]`, as the contract says it should, reads nothing different. A reader
that listed the folder instead now finds the right files there.

**Where it does not apply:** `tyto watch` and `tyto render --out`, which write the same folder
shape and still overwrite by name. Until `tyto watch` gets the same rule, the window and
`tyto watch` pointed at one queue folder differ here: a shrunken task retried from the window
ends with only its new slides, and the same task re-rendered by `tyto watch` keeps the old
ones beside a `result.json` that does not list them.

## Consequences

A queue task retried after its brief lost slides ends with the slides it has now. The
`result.json` of that run is the record of what went, which is the one file the contract asks
a caller to read.

What it does not cover:

- `tyto watch`, above. It is a card of its own.
- A `out/` with leftovers and no `result.json` keeps them, as in ADR 0054: nothing records
  that they are Tyto's.
- A file kept for one of ADR 0054's reasons is not in the new `result.json`'s `artifacts[]`.
  The `W_LEFTOVER_KEPT` warning is the last record of it.
