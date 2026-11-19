---
'@tyto/core': minor
'@tyto/recipe': minor
'@tyto/io': minor
'@tyto/desktop': minor
---

`rename-exports stem=<column> [digits=2] [path=<column>]` renames the images exported into
each delivery to the names it ships under, `<stem>-01.png` and on (TYTO-758, ADR 0218). The
numbers follow the record: the images each format owes, in the record's order of formats,
then any other image by name. Running it plans one line per file whose name changes; Apply
renames each delivery whole or not at all, failing it when a file changed since the plan or
a new name was taken, and never renames a file over another one. `core` gains
`deliveryExportNames`, the workspace ports a confined `rename`, and the step form its fields,
with their help in Portuguese.
