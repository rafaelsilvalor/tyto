---
'@tyto/desktop': minor
---

TYTO-297: "Format Brief" ("Arrumar brief", Alt+Shift+F in both input modes and in the command bar) fixes a brief's indentation, trailing spaces and repeated blank lines in one undoable step; a brief with a syntax error is left alone and the status bar says why. Two settings, commented in a new `settings.json`: `formatBriefOnSave` (false by default) formats a brief before Save writes it, and `tabSize` (2 by default) sets what Tab inserts, the indent guides' step and the indent Format Brief writes, applied on save with no restart.
