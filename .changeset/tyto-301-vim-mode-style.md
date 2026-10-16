---
'@tyto/desktop': minor
---

`vimModeStyle` in `settings.json` says how the status bar shows vim's mode: `"badge"` (the
default, only the mode's name coloured), `"border"` (a strip along the bar's top edge in the
mode's colour) or `"bar"` (the whole bar in the mode's colour, with text chosen to read on it at
4.5:1 or better in every theme Tyto ships). `statusBarColors`' `vimMode.*` colours apply to all
three, and under `"bar"` the mode's colour wins over `background`. Saving applies it with no
restart; with vim off every style is the plain bar. A new `settings.json` carries the key
commented out with the three values and what each does.
