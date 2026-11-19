# 0219 — `apply together` applies a run's plans in order, planned against the renames above

Status: accepted · 2026-11-19 · TYTO-758 · amends ADR 0208 (decision 3) and ADR 0170; builds on
ADR 0129, ADR 0138, ADR 0212, ADR 0216 and ADR 0218

## Context

TYTO-758 ships a delivery as one plan with one confirmation: rename the exports
(`rename-exports`, ADR 0218), upload the folder, write the sheet, comment on the tracker and move
it. Two rules stood in the way, read in the code at `origin/main` 912e97e6:

- **ADR 0208 decision 3: "There is no Apply all."** Each plan is confirmed on its own. A ship of
  five plans asks for five clicks, in an order nothing enforces.
- **A plan reads the disk as it is.** `google.drive-upload` plans one line per file it finds
  through `host.workspace` (ADR 0138, ADR 0212). Below a `rename-exports` whose plan is not yet
  applied, it lists the old names. Applied in order, the upload would then fail every file:
  the plan's paths are gone. A second run would plan it again, so the person would confirm
  twice for the plan they meant once.

The runner already knows which cells of a run are pending: it keeps the cells of the last run
per document (ADR 0148) and reuses only a prefix of them, from the first changed step down
(`firstChanged`), and a cell whose plan was applied is planned again with everything below it
(ADR 0170's note of 2026-11-12). So the plans above a step in one run are the kept cells above
it whose plan is not applied: no new bookkeeping.

The planned view is the risky piece, so it was kept narrow on purpose.

## Decision

### 1. `apply together` is a header line

**`apply together`** is the second word the `apply` header line takes, parsed into
`RecipeAst.apply = 'together'`. A recipe has one `apply` line, so `apply auto` and `apply
together` do not mix yet. It belongs in the header, as `apply auto` does (ADR 0170 decision 6).

### 2. One Apply carries out every plan of the run, in order

`RecipeRunner.applyTogether` applies every plan the document's last run kept, cell by cell in
the recipe's order, in one turn of the recipe file's Apply queue. **This amends ADR 0208
decision 3** for a recipe that says so: the plans are still shown one by one, under their
lines, and the person confirms them once.

- **Each cell's Apply is the one a click makes** (ADR 0170): the plan as shown, in batches, a
  long write asked again (ADR 0216), state committed from every plan's outcome, a plan not yet
  applied counting `skipped`.
- **The first cell whose Apply is refused, or fails an operation, stops it.** The plans below are
  not applied: they were planned against what that cell would have left. They wait for the next
  run, which plans them again. What the cells above applied stays applied. The answer says
  where it stopped and how many plans wait (`E_RECIPE_APPLY_TOGETHER`).
- **Every cell must have run this time.** A stale cell (Run this block, a held source) refuses
  the whole Apply before any write.
- **A cancel is read between cells** and between calls (ADR 0216); the cells not reached are not
  applied.
- `tyto recipe run --apply` applies such a recipe through it. The window's single Apply is the
  next pull request of the card; until then each plan keeps its own Apply.

### 3. A step plans against the renames above it, and only those

Under `apply together`, `runRecipe` hands each step **the renames the `rename-exports` plans above
it hold** (`VerbContext.plannedRenames`), from the cells it runs and, through
`RunOptions.plannedRenames`, from the cells the runner reused. While a contributed verb's plan
call that carries them runs, **`host.workspace.read`, a read of a part, `stat` and `list` answer
as if the renames were done**: a new name reads the file that will take it, with its size and
time (a rename keeps both), an old name is not there, and a folder lists the new names in place
of the old. Two files swapping numbers list as the files that take each name.

What is **not** projected, by design:

- Any other plan's writes: a file a plugin will write, a record `to-delivery` will change, a
  folder `to-delivery` will make. A step reads those as they are on disk.
- Built-in verbs' reads (`deliveries`, `to-delivery`, `to-brief`): they go through the host's
  own ports, not `host.workspace`, and none needs the new names.
- `host.workspace.write`, and every call outside such a plan call, an Apply included: at Apply
  the renames above have happened on disk.
- Recipes without `apply together`: their plans may be applied in any order, so nothing is read
  ahead.

**The view is the plugin's while its plan call runs** (`withPlannedRenames` in
`@tyto/plugin-api`, read by `checkedCapabilities`). Two plan calls of one plugin that carry
renames wait for each other. A call of the same plugin that carries none (another recipe's
source, an Apply) is not held back and sees the view while one is up, for the paths the renames
name only. That needs two recipes over the same delivery's exports at the same moment, and it
reads the files as they are about to be.

## Note, 2026-11-19 — the window's Apply all (TYTO-758, desktop pull request)

- **Apply all plans is drawn under the `apply together` header line**, once a run has planned,
  with a line saying what it does, over `recipe:apply-together`. It is offered while a plan may
  be applied, and is `aria-disabled` while its answer is on its way.
- **No plan has an Apply of its own under that header: the button is hidden, not disabled.** A
  lower plan was planned against the files the plans above it leave, so applying it first fails
  it, and a lone Apply would skip decision 2's stop at the first plan that does not go through.
  A disabled button would invite a click that can only be refused. Main still answers
  `recipe:apply` for one cell, which `tyto mcp` uses.
- **A long write's progress and Cancel** (ADR 0216) show under Apply all: main pushes
  `recipe:apply-progress` on the cell being applied (`RecipeApplyTogetherInput.onCell`) and files
  one cancel under that cell, so `recipe:apply-cancel` stops it between two calls.
- Where it stopped, or why it was refused, is said under the button until the next run.
- **Run recipe from the command bar** (`recipe.run`) is the run that reaches it: the button is
  drawn from that answer, as from the toolbar's.

## Consequences

- A ship recipe shows each plan under its line, the upload listing the files under the names they
  will have, and one confirmation carries it out. A step that fails leaves the rest planned for
  the next run, said in the answer, never applied against a state it did not plan for.
- No protocol change: the plugin keeps calling `host.workspace` as before, and the view is the
  host's. A plugin needs no new version to plan against it.
- A per-plugin wait while a view is up: plan calls carrying renames for one plugin run one at a
  time across documents. A view holds only renames, so it is cheap to build and to read.
- `tyto mcp`'s `run_recipe` still applies one cell by index; an agent applies a together recipe
  cell by cell, from the top. The desktop's single Apply, and `apply auto` with `together`, are
  later work.
