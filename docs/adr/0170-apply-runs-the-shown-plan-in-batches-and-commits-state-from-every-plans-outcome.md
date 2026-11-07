# 0170 — Apply runs the shown plan in batches and commits state from every plan's outcome

Status: accepted · 2026-11-07 · TYTO-378 · builds on ADR 0111, ADR 0129, ADR 0135 and ADR 0140

## Context

ADR 0129 says a write verb plans first and applies on confirmation, and that Apply runs the plan
that was shown. ADR 0135 decision 10 gave the plan its minimal shape and left `apply` to this
card. ADR 0140 decision 4 left wiring `stateToCommit` to Apply here too. Four questions were
open:

- How does a plugin apply "the plan as shown" without planning again? An operation's
  `description` is for a person; the plugin needs its own data (the issue's id, the status it
  read) to carry out exactly that operation and to tell that its target moved.
- A plan holds up to 10,000 operations (ADR 0135). One call under one deadline cannot carry them.
- A recipe may hold several plan cells, a person may apply some and not others, and the
  notebook reuses cells it does not run again. Which outcome decides the state?
- Buraqueira's parent rule read "did the artwork reach the tracker?" from the push of the same
  run. In a recipe the plan applies after the run, so TYTO-423 ported it with a `reached` input
  column that nothing fills.

TYTO-378 lands in four pull requests: this record with the contract in `@tyto/recipe` and
`@tyto/core`; the apply contribution across the plugin protocol; the host's Apply in the
desktop notebook; and `apply auto`.

## Decision

1. **An operation carries the plugin's own `payload`.** `PlannedOperation.payload?` is any JSON
   value, at most **2,048 bytes** as UTF-8 JSON (`PLAN_LIMITS.maxPayloadBytes`, provisional like
   the other plan ceilings), which `checkPlan` refuses past as `E_RECIPE_PLAN`. The host never
   reads it: it keeps the plan as shown and hands it back on Apply. A join's row stays the left
   row as `rowKey`; the right-hand target the write lands on travels in the payload, so a
   consumed row needs no provenance of its own.
2. **Apply hands the shown plan back to the verb, in batches of 100.** `Verb.apply?(plan)`
   answers one `AppliedOperation` per operation, in the order given. The host maps each answer
   onto the shown plan's `rowKey`, never the answer's, and stamps `appliedAt` from its own clock.
   An operation whose target moved answers `failed` with a `reason`; the others still run, and
   a batch that fails as a whole makes its operations `failed` with that reason.
3. **Before the first call, the host checks the kept plan again** against the writes the verb
   declares now. A plugin updated since the plan was shown may have dropped a write; then the
   whole Apply is refused with **`E_RECIPE_APPLY`**, before any write, rather than applied in
   part.
4. **State commits from the outcome of every plan cell of the run.** A plan never applied counts
   as `skipped`, so its rows keep their old state. Nothing is committed while any cell is stale
   (its inputs changed since it ran) or failed. `Cell.remembers` holds each cell's writes, so a
   cell the notebook reuses without running it again still has them to commit.
5. **An applied row remembers when.** `stateToCommit` merges `applied_at`, the latest
   `appliedAt` of the row's applied operations, into each put of that row, so a later run reads
   `last_applied_at` through `last`. A row no operation stood for is stored without it. TYTO-423's
   parent rule reads `last_applied_at is not empty` in place of the `reached` column.
6. **`apply auto` is a header line**, reserved like `param` and parsed into
   `RecipeAst.apply = 'auto'`; any other word after `apply`, a second one, or one after the first
   step is `E_RECIPE_SYNTAX`. It applies without a click only on an explicit Run in a trusted
   folder (ADR 0111). A restricted folder's recipe stops at the plan, and there is no scheduler
   yet.

## Consequences

- A plugin writes exactly what the person read, and can tell a moved target from the payload it
  planned with; it never re-plans on Apply.
- 10,000 operations of 2 KB each are about 20 MB of kept plan. That is the ceiling's worst
  case, not a measured one; a real plan's payload names an id and a status.
- One stale or failed cell blocks every state commit of the run. A sync that cannot commit
  tries again next run, which ADR 0140 already accepts as the cost of a failed write.
- `applied_at` is a column name the stamp takes: a recipe that remembers its own `applied_at`
  has it overwritten on an applied row.
- The apply contribution changes the plugin protocol's messages, so the second pull request
  bumps it from 15 to 16: ADR 0135 decision 8 kept it only because no message changed shape.
