---
'@tyto/recipe': minor
'@tyto/core': minor
---

TYTO-402, ADR 0176: the pure functions the window authors recipes with. `recipeSkeleton` writes
a new recipe that runs as made; `GENERIC_VERB_FORMS` gives every generic verb's fields and
`formOfArguments` a contributed verb's; `formatStep` writes a form's values as one recipe line
that parses and reads back through `valuesOfStep`; `referencesOf` lists the data files and
included recipes a recipe names. `@tyto/core` gains `E_RECIPE_FORM`.
