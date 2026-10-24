---
'@tyto/recipe': minor
'@tyto/core': minor
---

TYTO-375 (ADR 0128), first half: a new pure package, `@tyto/recipe`, holds the table that passes between recipe verbs (`Table`, `Column`, `Row`, `Provenance`), the `*.recipe` parser (`parseRecipe`: header, `|` description, `param` lines, one verb per line, every diagnostic with a range), the `where` filter grammar ported from Buraqueira's `flow.py` (`parseWhere`: `=`, `!=`, `~`, `!~`, `in`, `not in`, `is [not] empty`, `AND` only, values compared without case or accents), and the runner (`runRecipe`, asynchronous, one cell per line). The generic verbs `where`, `select`, `sort`, `show` and `keep` are registered by `createVerbRegistry`, which accepts only namespaced verbs from plugins; `createDerivationRegistry` starts empty. Aliases are input-only. `join`, `derive` and `run` follow in the second half. `core` gains the `E_RECIPE_*` codes and `W_RECIPE_WHERE_EMPTY`.
