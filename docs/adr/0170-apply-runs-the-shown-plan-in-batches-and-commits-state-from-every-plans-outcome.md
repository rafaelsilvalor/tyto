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

## Note, 2026-11-07 — choices the desktop's Apply made (TYTO-378, pull requests 3 and 4)

- **A stale cell's own plan is refused.** A cell the notebook kept but did not run this time
  still holds its plan and its id, and Apply on it answers `E_RECIPE_APPLY` ("its cell did not
  run this time"): its inputs may have changed since the plan was made, so the plan shown is
  not known to be the one its rows call for. Run the cell again for a plan that is.
- **Applies are serialised per document.** Main runs one Apply at a time per recipe, an
  `apply auto` run's included, so two outcomes never commit state over each other; Applies of
  different documents do not wait for each other.
- **Refusals are shown transiently, not kept on the cell.** A refusal comes only in the
  `recipe:apply` answer; the window shows it under the plan until the recipe's next run
  answers, and main keeps nothing of it. The cell it named may hold another plan by then, so a
  kept refusal could describe a plan nobody is looking at. A warning about an Apply that wrote
  and was not remembered (`W_RECIPE_NOT_REMEMBERED`) is the cell's own, and stays on it.

## Note, 2026-11-08 — decision 6 and the scheduler (TYTO-385)

"There is no scheduler yet" stops being true with ADR 0175. A scheduler follows the same two
conditions: a scheduled run in a trusted folder counts as an explicit Run, so `apply auto`
applies its plans, and in a restricted folder it runs nothing. `every` is a second header
line, parsed into `RecipeAst.every` and refused the same ways `apply auto` is: a malformed
one, a second one, or one after the first step.

## Note, 2026-11-11 — a run that plans nothing to write commits its state (TYTO-650)

Apply is offered only for a plan with at least one operation, and decision 4 commits state
only through Apply. A sync whose sheet and tracker already agree plans 0 operations on every
row, so it never stored what it saw, and every later run was a first run (found in TYTO-421's
by-hand run, 48 real rows). Buraqueira stored its state on every run.

The coordinator chose the automatic commit over an explicit "Remember" action, since no write
leaves the machine. The runner (`@tyto/io`, ADR 0188) commits the run's `remember` writes with
an **empty outcome**, as an Apply of the empty plans would, only when all of these hold:

- the run is **explicit**: Run, Run from here, Fetch again, or a scheduled run (ADR 0175). A
  pause in typing and a save never commit, and neither does `tyto mcp`'s `run_recipe`, which
  runs as a save: an agent's call is not a person's approval;
- the folder is **trusted**;
- the run is **still the current one** for its document when its turn comes;
- **every cell is ok**: none stale, failed or skipped, the bar decision 4 sets for Apply;
- **at least one cell holds a plan, and every plan holds no operation**, none applied already.
  A recipe with no plan cell commits nothing: a notebook that only reads still writes no state
  (ADR 0140 decision 4).

It waits in the recipe file's Apply queue, after any Apply and `apply auto` of the same file,
so it never commits beside a real Apply. **`applied_at` is not stamped**: nothing was applied,
so `stateToCommit` stores each row without it (decision 5), and `last_applied_at` keeps the
value of the last run that applied something to that row, or reads empty.

`apply auto` already committed in this case, through an Apply of the empty plan; that path is
unchanged, and its plan cell carries an applied record with no operations.
