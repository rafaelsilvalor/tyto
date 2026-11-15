---
'@tyto/editor': minor
'@tyto/desktop': patch
---

An indented line the editor wraps on screen keeps its indent on every row it takes (hanging
indent): each continuation row starts under the first character of the line's text, a tab
counting as `tabSize` columns. Briefs, JSON tabs and template buffers alike; a line at column 0
wraps as before (TYTO-707). The desktop gains the end-to-end suite that measures it.
