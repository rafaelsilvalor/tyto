---
'@tyto/desktop': patch
---

TYTO-263: on Windows, with a menu's list open from the title bar, Left and Right close it and open the neighbouring menu's list, wrapping at the ends — with Help open, Left opens Window, and with File open, Left opens Help. The arrow that moved the menu no longer reaches the editor or the menu row. Linux and macOS are unchanged.
