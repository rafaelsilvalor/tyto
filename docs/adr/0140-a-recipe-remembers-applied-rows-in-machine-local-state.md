# 0140 — A recipe remembers applied rows in machine-local state

Status: accepted · 2026-10-25 · TYTO-401 · builds on ADR 0128, ADR 0129, ADR 0130, ADR 0133,
ADR 0136, ADR 0137, ADR 0138 and ADR 0139

## Context

ADR 0136 left stateful status sync to its own card. Buraqueira's sync lets a sheet decide a
tracker's status, and the tracker decide the sheet's, row by row: `decidir` in `lib_status.py`
compares the sheet's cell and the tracker's status with what the sheet held **after the last
run**, which it calls `ultimo`. Whichever side moved since then wins; when both moved, the
sheet wins. Without `ultimo` (a first run, or lost state) only a sheet that says done beats the
tracker, because any other value may be a stale mirror. A parent's status is decided from its
children the same way.

A recipe has no memory between runs. It cannot get one from the plugin cache (ADR 0130,
ADR 0138): the cache is a plugin's, holds raw answers and may be bypassed by "run again without
the cache", and this state belongs to the recipe, whichever plugins it calls. Nor can it live in
the workspace: a folder is shared and versioned, and two people syncing from one checkout would
overwrite each other's memory of what they last applied.

TYTO-401 lands in four pull requests: this record, the port and the verbs `last` and `remember`
(`@tyto/recipe`); `decide`; the parent rollup and the stamp; and the host's adapter
(`@tyto/io`).

## Decision

1. **The port is `RecipeState`**, optional in `RunOptions` and in `VerbContext` as `state`, the
   way `resolveData` (ADR 0137) and `clock` (ADR 0139) are, and `run` hands it to the recipe it
   includes. `read(store, keys)` answers the stored entries of those keys, each
   `{ values, storedAt }`; a key with no entry is absent and a store never written is empty.
   `write(store, puts, deletes)` removes `deletes`, then merges each put's values over what its
   key holds, so a stored column the put does not name is kept. `storedAt` comes from the host's
   clock, never the recipe's. `@tyto/plugin-api` names the type, so the adapter implements a
   port from it.

   > **Amended by ADR 0144 (TYTO-423, 2026-10-26).** The port also requires `entries(store)`,
   > every entry a store holds, which the `recall` verb reads to bring back rows the source did
   > not fetch. Because `storedAt` is re-stamped on every put, it says when a row was last
   > remembered, not since when; an expiry measures from a stamped column instead.

2. **Where it lives: on the machine, outside the workspace**, at
   `TYTO_HOME/state/recipes/<sha256(workspace realpath + recipe path)>/<store>.json` (decided by
   the maintainer on 2026-10-25). The host binds the workspace and the recipe when it builds the
   port for a run; a verb names only a store and a row's key, and never sees a path. A store's
   name is a plain word (`[A-Za-z0-9][\w-]*`), so it is a file's name and nothing else. Reading
   works in a restricted workspace (ADR 0111): the data is the machine's, not the folder's.
3. **Identity is the recipe's path.** Renaming or moving the recipe, or opening the folder at
   another path, starts from no state, and the next run falls back to the rule for rows it does
   not know. That rule is the safe one by design (decision 6), so a lost state costs a cautious
   run, never a wrong write.
4. **A run writes no state; an applied plan does** (ADR 0129). `remember` returns `StateWrite`s
   that ride the run's result as `remembers`, as `keep`'s requests do (ADR 0130). The pure
   `stateToCommit(remembers, outcome)` decides what the host writes: nothing for a preview,
   which has no outcome; nothing of a row with any operation that did not apply (`failed` or
   `skipped`, matched on `PlannedOperation.rowKey`), so the next run still sees that row as
   changed and tries again, as Buraqueira's sync did; and nothing at all when an operation that
   stands for no row failed, since it may have touched any of them. Writes to one key fold in
   order: puts merge, and a forget starts the entry over. Wiring it to Apply is TYTO-378's.
5. **The verbs.**
   - `last <store> [by=<column>] [columns=a,b] [prefix=last_]` adds `last_<column>` for each
     stored column, or for those `columns=` lists, and `last_stored_at`. A row is found by its
     key, or by its `by=` column's value. A row with no entry reads null in every one of them.
     A column that would collide with one the table has is refused, as `nearest` and `join`
     refuse (ADR 0133 decision 7).
   - `remember <store> columns=a,b [by=<column>] [when="<where>"] [forget-when="<where>"]` asks
     to store each row's listed values under its key. `when=` leaves the rows it rejects alone;
     `forget-when=` deletes the entries of the rows it keeps. It adds no column.

   > **Amended by TYTO-421 (2026-11-08).** `decide`, the verb between them, takes
   > `tie=local|remote`: the side that wins a row both sides changed since the last run, `local`
   > when not given, which is the sheet-wins rule above. It writes `<column>_push`, the decided
   > value on push rows and empty elsewhere, for the write to the remote side to read, and
   > `<column>_overwritten`, the losing side's value where both changed (`_overrides` is true
   > there whichever side wins). The decided column may be the `local=` column itself, rewritten
   > in place as `map` rewrites its `into=`, so a synced sheet's column keeps its header. A
   > failed write still leaves that row's state as it was (decision 4), now covered end to end
   > by `last`, `decide`, `remember` and `stateToCommit` in one test.
   >
   > **Amended by TYTO-647 (2026-11-12).** `decide` also writes `<column>_pushes`, a boolean
   > true exactly on push rows whatever the decided value, and false on every other row.
   > `<column>_push` is empty both where nothing is pushed and where an empty value would be, so
   > a write that chose its rows by it could not push a cleared field; the boolean is what a
   > remote write's row filter reads, and `_push` stays the value written. Today an empty local
   > value still never pushes (`decideValue`, ported from `decidir_responsavel`), so the boolean
   > and a non-empty `_push` agree until a clear is allowed to push.
   >
   > **Amended by TYTO-647 (2026-11-12), clear.** A clear may now push, when the recipe asks:
   > `decide` takes `clear=push|pull`, `pull` when not given, which keeps the rule above byte
   > for byte. With `clear=push`, an empty local value where `last` was not is a local change,
   > cleared since the last run: it pushes the empty value (`_push` empty, `_pushes` true,
   > reason `local cleared`) when the remote side still holds `last`, is the same when the
   > remote side is empty too, and goes to `tie=` when the remote side changed as well. With no
   > `last` (a first run or a lost state) an empty value still never pushes, since the cell may
   > never have been filled; a value `values=` does not list never pushes; `hold-when-empty=`
   > still holds. It is opt-in because the rule above is right for a status flow: a status
   > cell cleared by mistake, or by a sheet filter, must not clear the tracker's status, while
   > a shared field such as an owner is one a person clears on purpose.

> **Amended by TYTO-714 (2026-11-14), clear guards.** `clear=push` now holds the clears of a
> run that look like a lost read rather than a person's edits, on by default whenever it is
> set, and generic in `decide`. A column guard: when the `local=` column is missing from the
> table, or empty on every row while `last` holds values, no clear is pushed that run, and
> one `W_RECIPE_DECIDE_CLEAR_COLUMN` names the column; without `clear=push` a missing column
> is still an error. A quantity guard: `decide` takes `clear-limit=<n>|none`, 5 when not
> given and only with `clear=push`; a run that would push more than n clears pushes none of
> them, and one `W_RECIPE_DECIDE_CLEAR_LIMIT` gives the count and says to raise the limit
> for that run, or write `none`. A held clear is a `hold` row (`_push` empty, `_pushes`
> false) whose decided value is `last`, so remembering the decided column, with or without
> `when=`, leaves the state as it was and the next run sees the same clears again. The
> maintainer decided both guards on 2026-11-14, after TYTO-686 recommended `clear=push` for
> a tracker's fields.

6. **A host without state is an error, never an empty store.** `last` and `remember` fail with
   `E_RECIPE_STATE` there. If `last` read null instead, every run would be a first run, and the
   first-run rule would let a sheet's done beat the tracker forever.
7. **Nothing is pruned on its own.** An entry stays until `forget-when=` deletes it; a row that
   leaves the table keeps its entry, which is harmless and lets it return. **Last writer wins**:
   the adapter replaces a store's file atomically, and there is no lock until a race is
   measured.
8. **One machine controls a flow.** The maintainer's direction: one main machine per flow owns
   the tracker writes; other machines may later own some of a sheet's fields. Today nothing
   enforces it: two machines running the same recipe against the same sheet each remember their
   own last run, and one can override the tracker with a value the other already pulled.
9. **A stamp the flow wrote is the only one it clears.** When a row leaves done, its done stamp
   is cleared only when `last_done_at` is set, that is, when the flow remembered writing it; a
   stamp a person typed stays. The stamp verb lands in the third pull request.

## Consequences

- The sync reads as a recipe: `last sync`, then `decide`, then the actions, then
  `remember sync columns=status,owner`. Every comparison with the last run is a column a person
  can see in the notebook before applying.
- A failed write leaves the row's memory as it was, so a retry needs no bookkeeping.
- The state is per machine and per path. Moving a recipe, or syncing one flow from two machines,
  is the declared limitation of decisions 3 and 8, and a later card's.
- The store has no ceiling, like the plugin cache (ADR 0130): it holds a row's few values per
  key, and a flow's rows are hundreds.

  > **Amended by TYTO-378 (2026-11-07).** The sentence above is wrong: the adapter
  > `recipeStateStore` (`@tyto/io`, #190) refuses a store file over **32 MiB**, the per-entry
  > ceiling of ADR 0138. A row's few values stay far under it.

> **Amended by ADR 0170 (TYTO-378, 2026-11-07).** Decision 4 is wired to Apply: the outcome
> covers every plan cell of the run, a plan never applied counting as `skipped`, and nothing is
> committed while a cell is stale or failed. `stateToCommit` also merges `applied_at`, the latest
> time the host stamped on a row's applied operations, into that row's puts, so a later run
> reads `last_applied_at`. `AppliedOperation` gains `reason?` and `appliedAt?`.
>
> **Amended by ADR 0170's note of 2026-11-11 (TYTO-650).** An explicit Run in a trusted folder
> whose plans all hold no operation commits its `remember` writes with an empty outcome, since no
> Apply ever would. A recipe with no plan cell still writes no state.
