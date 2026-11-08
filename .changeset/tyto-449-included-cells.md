---
'@tyto/recipe': minor
'@tyto/desktop': minor
---

TYTO-449: a recipe's `run` cell opens onto the included recipe's own cells. `@tyto/recipe` adds
`VerbOutput.included` and `Cell.included` (the `IncludedRecipe` type), set on a `run` that
succeeded; the desktop notebook carries them on the wire and shows them read-only, closed until
**Show the included recipe's cells** is clicked.
