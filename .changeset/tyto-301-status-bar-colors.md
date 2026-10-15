---
'@tyto/desktop': minor
---

`statusBarColors` in `settings.json` colours the status bar over the theme, in every theme:
`background`, `foreground`, `itemHoverBackground`, `itemHoverForeground`, `itemActiveBackground`,
`itemActiveForeground`, vim's badges (`vimMode.normal`, `vimMode.insert`, `vimMode.visual`,
`vimMode.replace`) and one text colour per item (`item.problems`, `item.template`…). Colours are
`#rgb` or `#rrggbb`; saving applies them with no restart, and removing one gives the theme's colour
back. An unknown key or a bad colour is a warning at it and only that one falls back to the theme.
A vim badge's text is the theme's best-reading colour on it, and a badge colour nothing reads
4.5:1 on still applies, with a warning that says the ratio; so does a
`background` or `foreground` that leaves the bar's own text under 4.5:1. A new `settings.json` carries the key
commented out, with every key and an example colour.
