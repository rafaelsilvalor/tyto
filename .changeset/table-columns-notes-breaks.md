---
'@tyto/core': minor
'@tyto/brief-lang': minor
'@tyto/house-style': minor
---

The one-image table shares its width by reading every cell of a column: from the minimums, the
leftover goes where it makes the table shortest, so one long cell in a row held tall by another
column no longer takes the room. A `::tabela` line with no `|` that starts with `*` is a note,
set small under the table; a `\` inside a row is a line break in that cell. A long
parenthesised phrase may break, its last word never alone, and a dash stays with the word
before it. In briefs, a lone `*` nothing on its line closes is a literal asterisk (ADR 0213),
and a `Break` the author typed carries `typed: true`.
