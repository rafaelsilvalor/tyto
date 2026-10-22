---
'@tyto/desktop': minor
---

TYTO-352: main can now create a file or folder, rename an entry and move an entry to the system's trash for the explorer, by id and name and never by path (`explorer:create`, `explorer:rename`, `explorer:delete`), and draw a native context menu of the window's items (`menu:context`). Names are checked the same on every operating system, nothing is ever overwritten, a delete never falls back to a hard delete, and open tabs follow a rename or let go of a deleted file. The window side comes in the next release.
