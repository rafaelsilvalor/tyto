---
'@tyto/editor': minor
---

TYTO-248: `EditorHandle.onVimStatus` reports vim's mode and pending keys from the library's public events, and `null` while vim is off, for a host that draws its own status bar; `EditorOptions.vimStatus: false` turns the library's own status line off. `cursorOf(state)` reads the line, the column and the selected character count off a state the host holds.
