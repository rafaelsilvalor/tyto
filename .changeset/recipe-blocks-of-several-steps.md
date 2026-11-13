---
'@tyto/recipe': minor
'@tyto/desktop': minor
---

A recipe's block is a run of lines between blank lines, like a Jupyter cell, and shows its last
step's result (TYTO-676, ADR 0196). `recipeBlocks` in `@tyto/recipe` reads blocks of several
steps and `#` lines, the header split from a step written right under it; `RecipeBlock.step`
becomes `steps: { first, last, lastFrom }`, and `recipeLines` lists a text's step or header
lines. `deleteBlock` takes the blank line that set the block apart. In the desktop a block draws
one result, its last step's, while every step still runs and marks its own problems; Run this
block runs all its steps; the "+" writes a new block; the counter and the fold are the block's;
Add step joins the block the cursor is in.
