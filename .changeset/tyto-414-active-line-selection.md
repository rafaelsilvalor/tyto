---
'@tyto/editor': minor
---

TYTO-414: the cursor's line is no longer shaded while text is selected — a word picked with
vim's `v`, a block from `Ctrl+V` or a drag with the mouse shows only the selection, as in VS
Code. The shading comes back when the selection is empty; the line's number keeps its own.
