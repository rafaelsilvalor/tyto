---
'@tyto/house-style': minor
---

`oneImageTable` draws its cells through the kit's `table` (TYTO-878). The art is the same to the pixel; the scene is one level deeper: each cell is a group named `cell` holding its rect, now unnamed, and its `cell-text`, and each row group carries its own place. A reader of the scene that looked for rects named `cell` directly under a row finds the cell groups instead.
