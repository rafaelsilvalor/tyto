---
'@tyto/editor': patch
---

Vim's Escape reaches vim while a completion is still pending (TYTO-331). Typing wakes completion, and CodeMirror's completion keymap took Escape for a query nobody could see yet, so an Escape pressed right after a word left vim in insert mode. `vimMode()` now cancels such an unseen query and lets the key through; a completion popup that is on screen still closes on Escape and keeps the key, as before. Without vim nothing changes.
