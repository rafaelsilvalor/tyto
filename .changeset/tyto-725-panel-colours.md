---
'@tyto/desktop': patch
---

The command panel colours a line by what it means, not by the stream it came on: a diagnostic
takes its severity's colour with its code in bold, its hint is muted, and any other stderr line
is plain text, so a run that ended ✓ 0 no longer shows red lines. Text inside a find match is
the window's own text colour. The light theme's warning colour is darker (#a48819 to #7e6813)
so warning text reads 5.19:1 on the panel (TYTO-725).
