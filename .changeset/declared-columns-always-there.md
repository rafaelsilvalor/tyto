---
'@tyto/recipe': minor
'@tyto/core': patch
'@tyto/desktop': patch
---

`deliveries` and `with-deliveries` take `fields=<name>,…` (TYTO-784, ADR 0213): the declared
fields a recipe lists always have their columns, empty when no record holds them, merged in
alphabetical order with the ones the records hold, so a step that reads one runs on the first
run. A fixed or invalid name is refused at `fields=` under the verb's own code, and
`with-deliveries` refuses a table that already has a `record_` column a listed name would add.
The two codes' summaries say so, and the desktop's recipe form shows the new field in
Portuguese.
