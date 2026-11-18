---
'@tyto/core': minor
'@tyto/recipe': minor
'@tyto/desktop': patch
---

A delivery record keeps the fields a recipe declares (ADR 0213): any name in
`to-delivery fields=` outside the fixed set is a text field, stored in the
record's `fields` map with its base in `written.fields`, merged like a fixed
field and taken by `keep=` and `inbound=`. A name `deliveries` already gives
as a column is refused at the argument, and one two edits from a fixed field
warns. `deliveries` adds declared fields as columns, alphabetical, after the
fixed ones. `to-delivery create=no` updates only folders that exist and names
the rows it skipped. The desktop's recipe form shows `create=` in Portuguese.
