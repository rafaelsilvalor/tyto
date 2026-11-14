# 0199 — A recipe names values with const and set, in one namespace read top-down

Status: accepted · 2026-11-14 · TYTO-727 · builds on ADR 0128 (decision 1, `param` lines) and
ADR 0196 (header lines are their own block) · amends ADR 0148 decision 2 (consts in the header
signature; a slice run starts from the values reused cells set)

## Context

A recipe could name only one kind of value: a `param`, which every way of running it may
override (`tyto recipe run --param`, the window, `tyto mcp`, a `run x name=value` line). Two
needs did not fit. A value the recipe's author fixes, a label or a project key written once and
used on several lines, was a `param` anyone could change by accident. And a value read from the
data, the latest due date in the table to keep only the rows on it, had no way in at all: a
`where` compares a row with constants, never with another row.

## Decision

### 1. `const name = value` is a header line that nothing overrides

It is read as `param` is, quotes taken off, and is written in the header block: it may not
follow a `|` (`CHAIN_REFUSED`) and the editor's blocks read it as a header line. A `const`
needs its value. A value supplied for it from outside is refused with `E_RECIPE_PARAM` saying
it is a `const` written in the recipe and takes no value from outside: `paramValues` in
`run.ts` is the one check for the CLI, the window and an agent, and `run x name=value`
(`include.ts`) refuses the same way. Consts ride `RecipeAst.consts` and fill `{name}` with the
parameters.

### 2. `set name = <aggregate>` is a generic verb that keeps one value for the steps below

`set` is a transform in Tyto's closed vocabulary (ADR 0128 decision 3). It reads its whole text
by its own rule, as `where` reads its expression: `set last_due = max due` is canonical, and
`set last_due=max due` reads the same. The aggregates are `count`, `min <column>`,
`max <column>`, `first <column>`, `last <column>` and `sum <column>`. `min` and `max` compare
as numbers when every non-empty cell reads as one, and otherwise as text without case or
accents, as `sort` does; `first` and `last` read the first and the last row; `sum` refuses a
cell that is not a number, naming its row. The value is stored as `cellText` writes it, a list
joined with `, `. On a table without rows `count` is `0` and every other aggregate is empty,
which the cell's `note` says; it is not a warning. The table passes through unchanged.

### 3. One namespace, read top-down

`param`, `const` and `set` share one set of names; a name declared a second time, in any
pairing, is `E_RECIPE_SYNTAX` at the second declaration. A `param` or a `const` is known on
every step. A `set` name is known only on the steps below its own: `{name}` above it, or in the
`set` itself, is `E_RECIPE_PARAM` at that use. The parser checks this, so a recipe that reads a
value before it exists never runs. An included recipe's consts and sets are its own: the `run`
cell hands back its table, never its names.

### 4. Values grow down the run: `VerbOutput.values` and `Cell.named`

Placeholders are still filled at run time. `runRecipe` keeps one map, seeded from
`RunOptions.values`, then the parameters and consts; after an ok cell whose verb answered
`values`, it adds them, and the cell records `named: { name, value }` for the notebook to show.
`VerbOutput.note` and `Cell.note` carry a line the result shows that is no diagnostic.

### 5. The notebook hands a slice the values its reused cells set

ADR 0148's runner reruns from the first changed step and reuses the cells above it. It keeps
each cell's `named`, and the steps it runs start from the values the reused cells set, through
`RunOptions.values`, so Run this block below a `set` filters on the kept value. The header
signature includes the consts, so editing one reruns every cell, as editing a parameter does.

## Consequences

- A recipe can compare rows with a value read from its own data, without a code cell or a
  second table.
- A `set` cell rerun alone leaves the cells below it stale, as any changed cell does; they read
  the new value when they run.
- `set` computes one value. A value per group (`set by team`) or a value read from another
  recipe would each need their own decision.
- The editor, the window and the manual learn `const` and `set` in a second pull request.

## Rejected

- **Substituting `set` values at parse time.** The value exists only once the table above it
  does; the parser can check scope, never content.
- **`const` as a `param` flagged read-only.** One word per meaning reads better in a header, and
  a refused override can say exactly what the line is.
- **A warning on an empty aggregate.** An empty table is a normal answer for a filter; a warning
  there would teach people to ignore the warnings column.
