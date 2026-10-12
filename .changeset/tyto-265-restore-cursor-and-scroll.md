---
'@tyto/desktop': minor
---

TYTO-265: after a quit or a reload, each tab comes back with its cursor where it was and scrolled to the same place, not at line 1. A file that got shorter on disk while the app was closed puts the cursor at the end of what is there. The undo history still starts empty.
