---
'@tyto/recipe': minor
'@tyto/core': minor
'@tyto/plugin-api': minor
---

TYTO-401 (ADR 0140): a recipe remembers applied rows between runs. `RunOptions` and `VerbContext` take an optional `state`, the `RecipeState` port (`read(store, keys)` and `write(store, puts, deletes)`), which `run` hands to the recipe it includes and `@tyto/plugin-api` names. `last <store> [by=<column>] [columns=a,b] [prefix=last_]` adds `last_<column>` for each stored column and `last_stored_at`, null for a row with no entry. `remember <store> columns=a,b [by=<column>] [when=…] [forget-when=…]` writes nothing during the run: its requests ride `RecipeRun.remembers`, and `stateToCommit(remembers, outcome)` returns what the host stores after an apply, dropping every row with an operation that did not apply and committing nothing for a preview. Both verbs fail with `E_RECIPE_STATE`, a new code in `@tyto/core`, where the host keeps no state.
