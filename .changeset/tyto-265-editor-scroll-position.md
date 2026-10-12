---
'@tyto/editor': minor
---

TYTO-265: `ScrollPosition` is plain data now — `{ top }`, the document offset of the line at the top of the pane — so a host can write it down and hand it back after a restart; `restore` puts that line at the top, clamped to the text. Within one run `restore` still puts the pane back to the pixel. `selectionOf(state)` reads the main selection as `{ anchor, head }`, and `withSelection(state, selection)` puts one back, clamped to the text and off the undo history.
