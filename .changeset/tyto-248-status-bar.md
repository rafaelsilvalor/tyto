---
'@tyto/desktop': minor
---

TYTO-248 (ADR 0076): the foot of the window is a one-line status bar. Left: buttons for the left area and the command bar, and vim's mode and pending keys while vim is on. Right: line and column with the selection size, the tab's kind, the brief's template, a problems button holding the count, queue, plugins, export, settings, the bottom and right area buttons, and the update notice. The area buttons hide and show a whole area through the new `layout.toggleDock:left|bottom|right` commands, and a hidden area is remembered in `layout.json`. The version, the platform, the template count and the template folder moved to Help ▸ About; the language picker left the window, and the language is switched from the command bar.
