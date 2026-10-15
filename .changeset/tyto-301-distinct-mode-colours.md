---
'@tyto/theme-pack': patch
---

TYTO-301 (ADR 0089 decision 8): vim's four modes no longer share a badge colour in any theme.
In 10 of the 20 themes two modes wore the same colour, because their roles are one colour
upstream; one of the two now takes another colour of the same palette, the hue vim themes give
that mode: Dracula's visual is its purple; Gruvbox Dark's and Light's normal is the palette's
blue and visual its purple; Solarized Dark's and Light's visual is Solarized's magenta, with the
lightness moved to read 4.5:1. Each original and its adjusted twin still draw the same badge.
A `derived` note names the colour used in its new optional `from` field
(`ThemeDerivationSource`), and the closest two badges of every theme are now at least
CIEDE2000 ΔE 10 apart.
