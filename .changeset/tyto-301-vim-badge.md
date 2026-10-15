---
'@tyto/desktop': minor
---

Vim's mode in the status bar is a coloured badge: NORMAL, INSERT, VISUAL (line and block too)
and REPLACE each in its own colour, in every theme, with text that reads at 4.5:1 or better. Until
now the badge was always the accent colour, which in Tyto Light read at only 4.01:1. The rest of
the bar looks as before. Themes gain ten colours for it: `status-bar` and `status-bar-text`, and a
background and a text for each mode (`status-bar-vim-normal`, `status-bar-vim-normal-text`…).
