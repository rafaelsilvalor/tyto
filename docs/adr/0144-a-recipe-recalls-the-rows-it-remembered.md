# 0144 — A recipe recalls the rows it remembered

Status: accepted · 2026-10-26 · TYTO-423 · builds on ADR 0139 and ADR 0140; changes ADR 0140
decision 1

## Context

ADR 0140 gave a recipe memory between runs, but only for the rows a run fetched: `last` reads
the entries of the keys in the table, and nothing else. Buraqueira keeps one more list,
`pais_esperando`: parents left waiting (for artwork, for animation) are checked again on later
runs even when the run's query did not bring them, and are dropped after 30 days or once they
stop waiting. Without it, a parent whose children finish while the parent is outside the
fetched table is never released.

Two things are missing. A recipe cannot list what a store holds, so it cannot bring back a key
the source did not fetch. And it has no expiry: ADR 0140 decision 7 prunes nothing on its own.

`storedAt` looks like an expiry clock and is not one. `write` stamps every put with the host's
now (ADR 0140 decision 1), and a waiting parent is remembered again on every run it still
waits, so `storedAt` says when it was last seen waiting. Buraqueira measures from the first time
a parent waited.

## Decision

1. **The port gains `entries(store)`**, required in `RecipeState`: every entry the store holds,
   `{ values, storedAt }` by key. A store never written is an empty map; a store that cannot be
   read is `E_RECIPE_STATE`, as `read` answers, never an empty map, for the reason ADR 0140
   decision 6 gives. It is required, not optional, so the compiler names every implementer: the
   host's `recipeStateStore` (`@tyto/io`) reads the same file `read` does. This changes ADR 0140
   decision 1, which listed `read` and `write` only.
2. **`recall <store> [by=<column>] [mark=<column>]`** appends one row per stored key that no
   row of the table has, matched on the row's key, or on the `by=` column when given. The new
   row's key is the stored key, its `by=` column holds it too, and every other column is null.
   The table's rows come first, then the recalled ones **sorted by key**, so two runs over one
   store append the same rows in the same order. `mark=` adds a boolean column, true on the
   recalled rows and false on the rest; there is no default marker, so a recipe that does not
   ask gets no column it did not name. A recalled key that is already some row's key while
   `by=` names another column is `E_RECIPE_ARGUMENTS`: two rows with one key could not both be
   written back. A host without state is `E_RECIPE_STATE`, as for `last`. A recalled row's
   provenance is `recall <store>`, with the key as its id and `storedAt` as when it was
   fetched.
3. **Current values come from a transform that re-fetches by key.** A recalled row has only its
   key; the plugin that owns the source fills it by asking for those keys (TYTO-386). A source
   never receives the table (ADR 0135), so recalling is a step after the source, never an
   argument to it. Until that transform runs, a recalled row's columns are null, and a recipe
   that decides on them sees nothing waiting.
4. **The expiry is a recipe pattern, not a mechanism.** A column carries when a row first
   waited: it is stamped (ADR 0140 decision 9's `stamp`) the first time, and brought back from
   the store after that; `age` (ADR 0139) reads how long ago that was against the run's clock;
   a `rules` table decides whether the row still waits; and `remember` stores it or forgets it:

   ```
   recall waiting by=parent
   last waiting by=parent columns=since
   compose since="{last_since|}"
   stamp since when="decision ~ wait" format="yyyy-MM-dd HH:mm"
   age since format="yyyy-MM-dd HH:mm" into=waited
   rules into=still_waiting using=[{"when": "decision ~ wait AND waited <= 720", "set": {"still_waiting": "yes"}}]
   remember waiting by=parent columns=since,decision when="still_waiting = yes" forget-when="still_waiting != yes"
   ```

   `last` names `columns=since` because, before any parent has waited, the store holds nothing
   and `last` would add no `last_since` for `compose` to read. The `rules` step is there
   because the `where` grammar has no `OR` and no `NOT`, by design (`where.ts`): "stops waiting
   or waited too long" is "not still waiting", and `!=` keeps the empty cells a row no rule
   matched has. 720 hours is Buraqueira's 30 days; a recipe writes its own.

## Consequences

- A parent left waiting is checked again on every run until it is released or expires, whether
  or not the source fetched it, once the re-fetching transform exists (TYTO-386).
- Every implementer of `RecipeState` must answer `entries`; a host that cannot list a store
  cannot offer `recall`.
- `recall` reads the whole store on every run. A flow's stores hold hundreds of keys
  (ADR 0140's consequences), so there is no paging.
- An expiry is as precise as the stamp's format: minutes here, so 720 hours is kept and 721 is
  forgotten.
