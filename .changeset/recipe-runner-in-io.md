---
'@tyto/io': minor
'@tyto/recipe': minor
'@tyto/desktop': patch
---

The recipe runner and its Apply move from the desktop's main into `@tyto/io` (`createRecipeRunner`,
ADR 0188), unchanged, so `tyto mcp` can run a recipe through the same code. The notebook's views,
`RECIPE_VIEWS`, move into `@tyto/recipe`. The desktop behaves as before.
