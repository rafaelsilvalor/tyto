---
'@tyto/editor': minor
'@tyto/recipe': minor
---

TYTO-712: the recipe editor reads the word after a `|` that chains steps as a verb. It colours
it as one and offers verbs there, splitting a line where the parser does, through
`chainSegments`, which `@tyto/recipe` now exports.
