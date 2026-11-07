---
'@tyto/plugin-api': minor
'@tyto/command-line': patch
---

An action or a sink may register `apply` (TYTO-378, ADR 0170). `apply(request)` is handed one
batch of at most 100 operations of the plan a person was shown (`APPLY_BATCH`), with the
step's arguments, the plan's target and the plugin's section, and answers one
`{ status, reason? }` per operation in the same order. A planned operation may carry the
plugin's own `payload`, which now crosses the isolation boundary. `recipeRegistriesOf` gives
such a verb `apply(plan)`: before any call it looks the verb up again and checks the kept plan
against the writes the verb declares now, refusing the whole Apply with `E_RECIPE_APPLY`; it
maps each answer onto the shown plan's row and stamps `appliedAt` from its own clock (the new
`now` option); a batch with no readable answer is `failed` with `APPLY_NO_ANSWER` and every
later batch `skipped`. **Breaking for plugins: the isolation protocol is 16**, so a plugin
process on 15 is refused at `hello`; a plugin that registers `apply` writes
`"engine": ">=0.15"`. The example recipe plugin's `example.mark` applies its plan into its
private cache. `@tyto/command-line` changes only a test.
