# 0171 — The recipe's views read rows from main in pages; show checks a view and its arguments against the window's views

Status: accepted · 2026-11-07 · TYTO-379 · builds on ADR 0128, ADR 0146 and ADR 0148

## Context

ADR 0128 made `show <view>` pick how the notebook draws a table and never which rows or columns
it has, and left the view's name for the notebook to check, "since views arrive with it". ADR
0148 sends each cell's first 50 rows to the window and keeps the whole table in main. The Table
view (TYTO-379) must scroll, sort, filter and copy a table of thousands of rows, and the views
after it (Board, Calendar, loose cards: TYTO-381, 383, 384) take arguments that name columns
(`show board by=status`). Three questions were open:

- Where do sort and filter run, when the window holds 50 rows of a table of 50,000?
- How does a view's page stay the table the person was shown, when the recipe runs again while
  they scroll?
- Who checks `show`'s view name and its arguments, and when? Until now nothing did: `show board`
  drew a blank cell, and `show board by=stauts` would be found only when the board was drawn.

## Decision

1. **A view reads the kept table from main in pages.** `recipe:rows {documentId, index, ranAt,
offset, limit ≤ 500, sort?, filter?, columns?}` answers `{columns, rows, total, matched}`,
   values cut as a cell's preview is (`RECIPE_WIRE_LIMITS.text`). The window never holds the
   whole table.
2. **Sort and filter are the view's, in main, over indices.** Main orders indices into the kept
   table (`src/main/recipe-rows.ts`, pure) and never moves its rows, so the next cell, `keep` and
   a sink read what the recipe produced (ADR 0128). The sort is the `sort` verb's comparator,
   exported from `@tyto/recipe` as `compareCells`, made total by the row's place: a view sorts as
   the recipe would. One sorted and filtered view is cached per document; scrolling reuses it,
   and a new query, a new run or another cell sorts again.
3. **The filter is one quick-filter text over the visible columns**, compared as `where`
   compares (no case, no accents). Per-column filters can come later without changing the
   channel's shape.
4. **A page names the run it reads.** The request carries the cell's `ranAt` as the window was
   shown it; a cell that ran again, or closed, answers `{stale: true}` and never another run's
   rows.
5. **The Summary view's totals follow the filter.** `recipe:rows` sends `totals` for a cell drawn
   in `summary`, computed by `summarize` over the rows the filter keeps, as ADR 0146 totals "what
   is shown".
6. **Copy is built and written in main.** `recipe:copy` takes the same query and a row range of
   at most 50,000 (`PAGE_LIMITS`' rows), builds tab-separated text from the whole values, quoting
   a field that holds a tab, a line break or a quote as a spreadsheet does, writes it with
   Electron's `clipboard.writeText`, and answers counts only.
7. **`show` checks its view and arguments against a list the host passes.** `RunOptions.views`
   (and `VerbContext.views`, which `run` hands on) maps a view name to its argument specs
   `{name, kind: 'column' | 'columns' | 'values' | 'choice', required?, types?, values?}`. A name
   not in the list is the new **`E_RECIPE_VIEW`** at the view's word, with a suggestion; an
   argument the view does not read, a missing required one or a stray word is
   `E_RECIPE_ARGUMENTS` at its range; a column resolves through `resolveColumn` and the aliases,
   so an unknown one is `E_RECIPE_UNKNOWN_COLUMN` with its suggestion. These specs are not
   plugin-api's `ArgumentSpec` (ADR 0135): a view's arguments name columns of the table it draws.
   **Without a list** (the CLI, a bare `runRecipe`), `show` takes any one name, as before.
8. **The notebook owns the list**, in `apps/desktop/shared/recipe-views.ts`, and main passes it
   to every run. This record ships `table` and `summary`, which take no argument; each view card
   adds its entry with the renderer that draws it.
9. **Each cell carries its view.** `Cell.view = {name, options}` is the last `show` at or above
   the cell, its arguments as read (canonical column names); the wire carries it, so the window
   draws every cell in the view chosen above it.

## Consequences

- A misspelt view or column is a diagnostic at its range while the recipe is typed, in the
  notebook; a recipe that names a view only another host draws still runs in the CLI.
- The window's views ask main for what they show; a view that groups (the Board) adds its own
  channel over the same filtered copy rather than counting in the renderer.
- A copy of thousands of rows never crosses to the window, and is never cut at 1,000 characters.
- Two new channels, `recipe:rows` and `recipe:copy`, have no window caller until the Table view
  lands (TYTO-379's second pull request).

## Notes from the build

- 2026-11-07 (TYTO-379, second pull request): a cell with no `show` line at or above it keeps
  the compact preview of its first rows (TYTO-377); only `show table` and `show summary` draw
  the paged view. Decision 9 is read as "the view chosen above it, when one was".
- 2026-11-07 (TYTO-379, second pull request): `recipe:copy` gained an optional `copyColumns`,
  the columns written, apart from `columns`, which the quick filter matches over. Filtering over
  the copied columns, as the first pull request did, could copy different rows than the view
  showed when the selection spanned only some of the shown columns (decision 6).
- 2026-11-08 (TYTO-379, third pull request): a cell's result opens full size in a tab of its
  own, an `EditorTab` with `view: 'recipe-view'` and the cell's index, beside the preview tab of
  ADR 0084. **It draws the cell's current view, not only the Table**: Board (TYTO-381), Calendar
  (TYTO-383) and Cards (TYTO-384) merged before it, so the tab draws through the same view map
  in `renderer/recipe-views.ts` as the cell does (`fullSizeBody`), and a cell under no `show`
  opens in the Table, since a tab has room for every row. Only the Table and Summary needed a
  change to draw full size (their viewport takes the tab's height); the others keep their
  renderers and the stylesheet lifts their in-cell height caps inside the tab. The tab pages by
  the cell's index and `ranAt` like the cell (decision 4), redraws from the recipe's newest
  answer, closes with its recipe, and is left out of the session: its rows live in main only
  while the run does. The cells under a `run` step (TYTO-449) draw a plain preview and get no
  tab.
