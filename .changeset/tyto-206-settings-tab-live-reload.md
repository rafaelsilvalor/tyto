---
'@tyto/desktop': minor
'@tyto/editor': minor
---

TYTO-206, PR B: "Preferences: Open Settings (JSON)" opens `settings.json` in a tab. Its problems
show in the problems panel while you type, a save from the tab or any editor applies with no
restart, and a screen's change goes into the tab's unsaved buffer instead of the disk. A screen's
change to a file that does not parse is refused, undone and shown. `@tyto/editor`'s `blank`
takes an optional language for one document, without the host's language extensions.
