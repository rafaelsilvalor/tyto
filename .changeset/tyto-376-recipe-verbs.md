---
'@tyto/plugin-api': minor
'@tyto/recipe': minor
'@tyto/core': minor
'@tyto/cli': patch
---

TYTO-376 (ADR 0135), first half: a plugin can contribute recipe verbs and derivations. `@tyto/plugin-api` has two new extension points, `recipe-verb` (a paged `source` or a `transform`, with its arguments declared as a small closed schema) and `recipe-derivation` (for `derive`), both named `<namespace>.<name>` in the one `namespace` a manifest now declares and owns alone; a second plugin claiming a loaded plugin's namespace is refused with `E_PLUGIN_NAMESPACE_TAKEN`, and an `action` or `sink` verb is refused until the second half. They cross to an installed plugin's process, and `recipeRegistriesOf(registry)` hands the recipe runner its verb and derivation registries. `@tyto/recipe` gains `checkTable`, `readArguments` and `pagedSource`, which loops a source page by page under provisional ceilings (8 MiB and 5,000 rows per page, 100,000 rows, 1,000 pages) and refuses a repeated cursor or a truncated page rather than answer a partial table; a plugin's derivation may be namespaced. `@tyto/core` gains `E_PLUGIN_NAMESPACE_TAKEN`, `E_RECIPE_TABLE`, `E_RECIPE_SOURCE` and `E_RECIPE_VERB`. `tyto` loads an installed plugin that contributes them.
