---
'@tyto/recipe': minor
'@tyto/editor': minor
'@tyto/io': minor
'@tyto/desktop': minor
---

A recipe reads as blocks in the window (TYTO-676, ADR 0195). `@tyto/recipe` gains
`recipeBlocks`, the text read by line as header, step and note blocks, and `moveBlock` and
`deleteBlock`, each one edit of the text that keeps every other byte. `@tyto/editor` gains
`notebookFrames()`, which frames each block over the one editor with the host's toolbar on its
first line, and `cellOutputAt`. The runner takes `until`, the cell a run stops after. In the
desktop each block but the header has a toolbar: Run this block, Move up, Move down, Delete
block, and Hide result, which now folds a plan's lines and a run cell's included cells too.
