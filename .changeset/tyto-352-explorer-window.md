---
'@tyto/desktop': minor
---

TYTO-352: the explorer makes, renames and deletes files and folders. Right-click an entry for New File…, New Folder…, Rename… and Delete, or the empty space for the two New items; F2 renames and Delete deletes the selected entry. The name is typed in the tree, and a taken or impossible name keeps the field open with a line saying why. A delete always asks first and moves the entry to the Recycle Bin (the Trash on macOS and Linux). A renamed brief's tab shows the new name and keeps unsaved text unsaved; a deleted one's tab keeps its text in no file. A write the disk refuses for another reason, such as a read-only drive, now says so instead of failing silently.
