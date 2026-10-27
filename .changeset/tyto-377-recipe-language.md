---
'@tyto/editor': minor
---

TYTO-377: the editor reads `.recipe` files. `createEditor({ language: 'recipe' })` colours a recipe line by line — the header, the `|` description, `param` lines, comments, the verb at the start of each line (a plugin's namespaced `jira.pull` included), `name=` arguments, quoted values, `{param}` placeholders and `@./file.json#/pointer` data references. `recipeCompletion(verbs)` offers the verbs the host names at the start of a line. `cellOutputs()` with `setCellOutputs` puts an element the host builds under a line, keeps it there while the text is edited, drops it when its line is deleted, and keeps the element of a key it already holds instead of building it again.
