---
'@tyto/desktop': minor
---

TYTO-272: five new settings, commented in a new `settings.json`, set the window's type and zoom, all applied on save with no restart. `uiFontSize` (9 to 24, default 14) scales every label outside the editor — tabs, panels, the status bar, the preview's controls and the dialogs — and the strips grow so nothing is cut; `codeFontSize` (9 to 32, default 14) sets the editor's, and the indent guides and pinned head lines follow. `uiFontFamily` and `codeFontFamily` name a face, with the bundled one drawn when the machine lacks it and `W_FONT_FAMILY_MISSING` in the problems panel. `zoom` (-5 to 5) zooms the whole window in steps of 20%: View's Zoom In, Zoom Out and Reset Zoom, on Ctrl and =, - and 0, now write it to `settings.json`. At the defaults the window is pixel for pixel what it was. The native menus and dialogs keep the system's font.
