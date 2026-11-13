---
'@tyto/editor': minor
'@tyto/desktop': minor
---

A recipe's blocks gain a "+" between them and an execution counter (TYTO-676, ADR 0195).
`notebookFrames()` in `@tyto/editor` takes an `insert` control drawn on every boundary, read
back with `notebookInsertOf`, and a frame's `marker`, shown in a gutter of its own. In the
desktop the "+" offers Step…, the step picker writing its line there, and Note; notes read as
prose; each step shows `[n]`, `[*]`, `[ ]` or a stale `[n]`; a step's toolbar gains Run from
here down and the header's Run all.
