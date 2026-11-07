---
'@tyto/desktop': minor
---

The recipe notebook draws a cell under `show table` or `show summary` in the Table view
(TYTO-379, ADR 0171): every row of the kept table, in a twelve-row viewport that draws only the
rows in sight and reads them from main a page at a time over `recipe:rows`. A header sorts in
main, one quick-filter box filters over the shown columns, a column picker hides columns, and a
click, Shift-click or Ctrl+A selects a rectangle that Copy or Ctrl+C writes as tab-separated text
through `recipe:copy`, which takes the copied columns apart from the filtered ones
(`copyColumns`). Summary adds main's totals over the rows the filter keeps. Numbers are
right-aligned, dates follow the window's language, and a `link` value is an anchor only for an
`http` or `https` address; the window's open handler now hands only those two schemes to the
system browser (`externalUrlAllowed`). A cell under no `show` keeps its preview.
