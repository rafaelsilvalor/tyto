---
'@tyto/brief-lang': minor
'@tyto/editor': minor
---

TYTO-680: a comment line inside an indented block is skipped and the block goes on (ADR 0204).
An indented `//` line is always a comment of its block; a `//` at column 0 is the block's when
indented lines follow it, and a top-level comment otherwise. A body line that starts with `//`
is written `\//`, and `writeBrief` escapes one. This changes one brief that compiled before: an
indented line starting with `//` was body text and is now a comment. Format Brief indents a
comment inside a block like its body lines; the editor folds it with the block, counts it in
the block's range and offers no completion in front of it.
