---
'@tyto/desktop': patch
---

The command panel colours a line by what it means, not by the stream it came on: a diagnostic
takes its severity's colour with its code in bold, its hint is muted, and any other stderr line
is plain text, so a run that ended ✓ 0 no longer shows red lines. Text inside a find match is
the window's own text colour, and what a built-in such as `history` prints is plain output. The
light theme's warning (#a48819 to #7e6813) and success (#4f8a43 to #447639) are darker, so
warning text and the ✓ badge read above 5:1 on the panel (TYTO-725).
