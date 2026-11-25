---
'@tyto/template-kit': minor
'@tyto/house-style': patch
---

TYTO-859: `table`, a generic table that lays out cells and draws no words — fixed, fill or
measured columns, row kinds with their own fill and zebra, bands, corners on every cell or on
the table's outer edge, and cell content handed in as blocks built by the text components.
`pillTable` is now `slotTable`, that table with a slot reading on top; the old names stay as
deprecated aliases. house-style's presets use the new names.
