---
'@tyto/editor': minor
---

TYTO-120: `hasBeenEdited(state)` says whether a document's undo history holds anything. A document `blank()` built answers `false`, and so does one undone all the way back; one typed into and then emptied answers `true`, which `textOf(state) === ''` cannot tell apart from a fresh one.
