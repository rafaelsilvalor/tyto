---
'@tyto/desktop': patch
---

TYTO-711: on a recipe line that chains steps with `|`, Edit step opens the step under the
cursor and Open cell result in a tab opens that step's result, not the line's first. On the
`|` or the blanks around it, the side of the `|` the cursor is on wins; past the last step, the
last. A result tab opened on a chained line keeps drawing the step it was opened for.
