---
'@tyto/editor': minor
---

TYTO-272: the editor's text size is the host's `--tyto-code-size` (`codeSize` in the theme, listed in `themeTokens`). New `EditorHandle.remeasure()` and `remeasureText(view)` make every pane read its line height and character width again after the host changed the face or size, and the indent guides and the pinned head lines redraw on it — a new face at the same size used to leave the guides off their columns.
