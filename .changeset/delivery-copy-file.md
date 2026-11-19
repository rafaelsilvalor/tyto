---
'@tyto/core': minor
'@tyto/recipe': minor
'@tyto/io': minor
'@tyto/desktop': minor
---

`to-delivery copy-text=<column>` keeps each delivery's copy in `editaveis/copy.md`
(TYTO-756, ADR 0217): a `Source:` line with the record's `copy`, then the cell's text as it
is, Markdown or plain. The record remembers the digest of the copy it wrote in
`written.files`, so a copy a person edited since is kept, never overwritten, and the plan's
note names it on every run; a missing copy is written again, and Apply fails a row whose
copy changed since the plan. The step form gains the field, with its help in Portuguese.
