---
'@tyto/desktop': patch
---

TYTO-120: opening a file no longer replaces an untitled tab that was typed into and then emptied. The tab stays beside the new file, and Ctrl+Z in it brings the deleted text back. The same holds for a tab that lost its file to a save-as and was then emptied. The untouched tab the window opens on is still replaced, as before.
