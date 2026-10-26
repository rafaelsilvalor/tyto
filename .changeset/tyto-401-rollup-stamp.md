---
'@tyto/recipe': minor
'@tyto/core': minor
---

TYTO-401 (ADR 0140): `rollup <column> parent=<column> [when="<where>"]` counts, on each row that is another row's parent, its children that `when` keeps, and leaves every other row empty; children whose parent is not in the table count nowhere and raise `W_RECIPE_ROLLUP_ORPHANS`, a new warning in `@tyto/core`. `stamp <column> when="<where>" format="dd-MM HH:mm" [clear-when="<where>"]` writes the run clock's wall-clock time into the empty cells of the rows `when` keeps, never overwrites a cell that holds something, and empties the cell on the rows `clear-when` keeps. `age` takes `month-into=<column>`, the month the stamp files under as `yyyy-MM`. A parent's decision is a few rollups and a `rules` table, and the 72-hour hold is `age` and `where`.
