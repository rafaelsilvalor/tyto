---
'@tyto/core': minor
'@tyto/recipe': minor
'@tyto/plugin-api': minor
'@tyto/io': minor
'@tyto/command-line': minor
'@tyto/desktop': patch
---

`apply together`, a recipe header line, applies every plan of a run in order with one
confirmation (TYTO-758, ADR 0219): `RecipeRunner.applyTogether` applies each cell's plan as
its own Apply would and stops at the first cell that is refused or fails an operation,
leaving the plans below for the next run (`E_RECIPE_APPLY_TOGETHER`). Under it, a plugin's
step plans against the renames a `rename-exports` above it planned: `host.workspace` reads,
stats and lists the new names while that plan call runs, and nothing else is read ahead.
`tyto recipe run --apply` applies such a recipe this way; the window's single Apply follows.
