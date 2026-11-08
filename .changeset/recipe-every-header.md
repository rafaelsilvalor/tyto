---
'@tyto/recipe': minor
---

TYTO-385: a recipe's header may say `every 30m` or `every 2h`, parsed into `RecipeAst.every` in
minutes. Under 5 minutes, a second `every`, or one after the first step is `E_RECIPE_SYNTAX`.
Nothing runs it on that interval yet.
