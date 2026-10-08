---
'@tyto/editor': patch
---

A selection on the cursor's line shows again (TYTO-246). The active line's background is now
translucent, composited to the same colour it had when opaque, so the selection that
`drawSelection` paints behind the text shows through it — with the mouse, with vim's `V` and with
vim's Ctrl+V. The gutter keeps the opaque colour.
