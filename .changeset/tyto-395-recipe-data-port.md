---
'@tyto/recipe': minor
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/io': minor
---

TYTO-395 (ADR 0137): a recipe verb can read configuration from a JSON file beside the recipe, written `@./vocab.json#/kinds` (a JSON Pointer into the file) or `@./vocab.json` for the whole document. `@tyto/recipe` gains the optional `resolveData` port in `RunOptions` and `VerbContext` (passed on by `run`) and `readDataArgument`, which parses the reference, walks the pointer and checks the slice with the verb's Zod schema, reporting every refusal at the argument. `@tyto/io` gains `workspaceDataResolver`, which reads JSON with comments relative to the recipe's folder, confined to the workspace lexically and after `realpath`, refuses every file in a restricted workspace and caps a file at 1 MiB, and `readJsoncValue`. `@tyto/plugin-api` re-exports the `DataResolver` type. `@tyto/core` gains `E_RECIPE_DATA`, `E_RECIPE_DATA_RESTRICTED`, `E_RECIPE_DATA_SYNTAX` and `E_RECIPE_DATA_SHAPE`.
