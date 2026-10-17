---
'@tyto/editor': minor
---

TYTO-305: Enter in a brief keeps the indent of the line it leaves, so a block is typed with one Tab and then Enter only. On a blank line after a line with text the blank line stays and the next line keeps the block's indent; on a second blank line in a row no line is added and the cursor goes back to column 0, where the next directive starts. Shift+Enter, Tab, an open completion list and the frontmatter are unchanged, and JSON tabs and template buffers keep CodeMirror's Enter.
