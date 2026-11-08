---
'@tyto/desktop': minor
---

A recipe cell's result opens full size in a tab of its own (TYTO-379, ADR 0171): **Open in a
tab** on a cell whose table main keeps, or the command **Open cell result in a tab** for the
cell at or above the cursor. The tab draws the cell's current view (Table, Summary, Board,
Calendar or Cards; the Table for a cell under no `show`) from the recipe's newest run, the
Table's viewport stretched to the tab. One tab per cell; it closes with its recipe and no
session brings it back.
