---
'@tyto/core': minor
'@tyto/brief-lang': minor
'@tyto/pipeline': patch
'@tyto/recipe': minor
'@tyto/plugin-api': minor
---

A recipe gains the generic sink `to-brief template=<name> into=<folder> name=<column>
slots=<slot>:<column>,…` (TYTO-380, ADR 0172): it plans one brief per row in the chosen template,
each marked new or overwriting, and writes them on Apply through `ToBriefPorts` the host lends
through `createVerbRegistry({ briefs })` and `recipeRegistriesOf`'s `briefs` option; a file
changed since the plan fails that write while the others apply. `@tyto/brief-lang` gains
`writeBrief`, which writes a brief from a template name and slot values and parses it back,
refusing a value that holds a brace. `@tyto/core` gains `fileSafeName`, which the pipeline's
`artifactName` now calls, and the diagnostic code `E_RECIPE_BRIEF`.
