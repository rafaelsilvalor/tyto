---
'@tyto/editor': minor
---

TYTO-297: `formatBriefInView` applies Format Brief as one undoable change that keeps the caret on its text, and refuses a brief with a syntax error without touching it. New `tabSize` option and `setTabSize`: spaces per indent level, for what Tab inserts, the tab width, the indent guides' step and the indent Format Brief writes, changed live in every pane. The indent guides now redraw when the indent unit changes with no edit.
