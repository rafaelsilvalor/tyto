---
'@tyto/editor': patch
'@tyto/desktop': patch
---

TYTO-703: CodeMirror's height map follows a recipe result folded in place. `remeasureCellOutput`
now asks for the lines' heights, which a plain measure reads only when the content box changed
height, and a recipe shorter than its pane never changes it: before, every line below a fold was
placed 74 px too low by the map while drawn at its real place.
