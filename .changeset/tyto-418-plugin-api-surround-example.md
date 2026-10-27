---
'@tyto/plugin-api': patch
---

TYTO-418: the `editor.vim` test's example contribution maps surround's `s` in operator-pending
mode, as the built-in does, instead of `ys` in normal mode, which the engine never reaches.
