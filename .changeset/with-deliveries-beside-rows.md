---
'@tyto/core': patch
'@tyto/recipe': minor
'@tyto/plugin-api': patch
'@tyto/desktop': patch
---

A recipe brings each row's delivery record beside its own columns with
`with-deliveries by=<column>` (TYTO-779, ADR 0213): the folder the column
names, matched whatever its case, gives its record's fields as `record_`
columns, `record_link` a link; `record_folder` is empty where the row has no
folder, and so is every other brought cell. It reads the folders once per run
and writes nothing; it refuses with `E_RECIPE_WITH_DELIVERIES`, and the two
delivery warnings name the verb that reported them.
The desktop's recipe form shows the new verb in Portuguese.
