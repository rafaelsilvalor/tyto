---
'@tyto/recipe': minor
'@tyto/core': minor
---

TYTO-375 (ADR 0133), second half: the recipe package gains its last three generic verbs. `join <prefix> left="…" right="…" on=<column> [bring=…]` pairs rows of the one table on a key column, which may hold a list on either side; the right side is consumed into `<prefix>_<column>` columns, and `<prefix>_match` says `paired`, `ambiguous (N candidates)`, `no key` or `no pair`, an ambiguous key never pairing. `derive <name>…` runs registered derivations, awaiting each, after checking the columns it requires and before trusting the columns it promised. `run <recipe> name=value…` includes another recipe at its line through the `resolveRecipe` port, refusing a cycle. A verb's output now carries `keeps` (a list) instead of `keep`, and its context carries the verb registry and the recipes running. `core` gains `E_RECIPE_DERIVATION`, `E_RECIPE_RUN` and `W_RECIPE_JOIN_AMBIGUOUS`.
