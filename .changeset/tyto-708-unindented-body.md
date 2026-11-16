---
'@tyto/brief-lang': minor
'@tyto/core': minor
'@tyto/editor': patch
'@tyto/template-kit': patch
---

A text line at column 0 under a directive is a body line of that directive, exactly as if it
were indented (TYTO-708, ADR 0202): `::lamina` / `Linha um` / `Linha dois` is one slide with
two lines and compiles to the Scene of its indented twin. A blank line between two column-0
lines is a paragraph, and a column-0 comment followed by column-0 text stays in the block
(ADR 0204, note of 2026-11-16). Text before the first directive is still `E_SYNTAX`. No brief
that compiled before changes: a column-0 text line used to be a syntax error.

`@tyto/core`: new warning `W_LIKELY_DIRECTIVE`, for a column-0 body line that starts with a
single `:` and a name (`:titulo X`), which is kept as text.

`@tyto/editor`: tests pin folds, `briefBlocks`, sticky scroll and completion on a column-0
body line (test only). `@tyto/template-kit`: a contract test compiles the unindented brief
against its indented twin (test only).
