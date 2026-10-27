---
'@tyto/recipe': minor
'@tyto/io': minor
'@tyto/plugin-api': minor
---

TYTO-423 (ADR 0144): a recipe brings back the rows it remembered. `RecipeState`, which `@tyto/plugin-api` names, requires `entries(store)`: every entry a store holds, empty for a store never written and `E_RECIPE_STATE` for one that cannot be read. `recipeStateStore` implements it. `recall <store> [by=<column>] [mark=<column>]` appends one row per stored key the table lacks, after the table's rows and sorted by key, with the key (and the `by=` column) set and every other column null; `mark=` adds a boolean column true on the recalled rows. A recalled key that is already another row's key under `by=` is refused, and a host without state fails as `last` does. An expiry is a recipe pattern (stamp, `age`, `rules`, `remember … forget-when=`), documented in the ADR.
