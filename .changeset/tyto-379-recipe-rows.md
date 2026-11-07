---
'@tyto/recipe': minor
'@tyto/core': minor
'@tyto/desktop': minor
---

A recipe's views read rows from main in pages, and `show` checks its view (TYTO-379, ADR 0171).
`RunOptions.views` and `VerbContext.views` map a view name to the arguments it reads
(`ViewArgumentSpec`: `column`, `columns`, `values` or `choice`); with a list, `show` refuses a
view not in it as `E_RECIPE_VIEW` (new in core) at the view's word, and an unknown, missing or
stray argument at its range, columns resolved through the aliases. Without a list `show` takes
any one name, as before. Every cell carries `Cell.view`, the last `show` at or above it with its
arguments, and `run` hands the list and the included recipe's view on. The `sort` verb's order
is exported as `compareCells`. In the desktop, main passes the notebook's views (`table`,
`summary`) to every run, the cell on the wire carries its view, and two channels read a cell's
kept table: `recipe:rows` answers a page of it sorted and filtered in main over indices, never
moving the recipe's rows, with the Summary's totals over the rows the filter keeps, and
`recipe:copy` writes rows to the clipboard as quoted tab-separated text built from the whole
values. A page names the run it reads and a newer one answers `stale`. The Table view follows.
