---
'@tyto/editor': minor
'@tyto/desktop': minor
---

A recipe has Jupyter's command mode (TYTO-676, ADR 0195 decision 7). `@tyto/editor` gains an
eighth keybinding context, `notebook`, where a key needs no modifier; `notebookFrames()` makes
its toolbars' layer the command target, with `enterNotebookCommand`, `leaveNotebookCommand`,
`selectedNotebookFrame` and `stepNotebookSelection`; and `vimToNormal`. In the desktop, Escape
(Shift+Escape in vim, Ctrl+M in both) enters command mode, where A, B, D D, Enter, Shift+Enter,
J, K, the arrows, O and Z act on the selected block; Shift+Enter in a recipe's text runs the
cursor's block and moves on.
