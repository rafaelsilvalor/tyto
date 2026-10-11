---
'@tyto/desktop': minor
---

TYTO-113: the window reopens where the person left it — the same tabs, in the same order, with the same one in front, and the text typed and not saved still in them. Quitting with unsaved work asks nothing any more; the drafts are kept in the app's own data folder and come back on the next launch. A file that changed on disk while the app was closed opens with the disk's text and the draft in a new tab beside it; a file that is gone is named in the problems panel. Reload is back on the View menu and on Ctrl+R, and brings every tab back. The undo history does not survive a restart.
