---
'@tyto/io': patch
---

An explicit Run of a recipe in a trusted folder whose plans hold no operation now commits the
recipe's `remember` writes, with no `applied_at` (TYTO-650, ADR 0170 note of 2026-11-11). A
recipe whose two sides already agree stores what it last saw, and its next run reads it through
`last`. A save, a pause in typing, `tyto mcp`'s `run_recipe`, a folder not trusted, a stale or
failed cell, or a recipe with no plan cell still commit nothing.
