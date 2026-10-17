---
'@tyto/brief-lang': minor
---

TYTO-294: a blank line has no meaning and does not end an indented block (ADR 0087). One or several blank lines in a row, empty or holding only spaces, inside a block — between two groups of a `::lamina`, or between the directive and its first body line — parse to the AST the brief has without them, and a block ends only at the next non-blank line back at column 0. A line of spaces at the top level is blank too, and a directive's range ends at its last line with text.
