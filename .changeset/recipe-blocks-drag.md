---
'@tyto/recipe': minor
'@tyto/editor': minor
'@tyto/desktop': minor
---

A recipe's block can be dragged to another place by its grip (TYTO-676). `moveBlockTo` in
`@tyto/recipe` moves a block before any other, or below the last, as one edit that rewrites the
blocks passed over and never the block moved. `notebookFrames()` in `@tyto/editor` draws a grip
on each movable frame, drags with pointer events (Escape, blur or an edit cancel it) and draws
the drop line; the host's `move` receives the drop. In the desktop the drop is one undo.
