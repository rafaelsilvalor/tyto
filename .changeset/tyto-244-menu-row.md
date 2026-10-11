---
'@tyto/desktop': minor
---

TYTO-244 (ADR 0078): on Windows and Linux the title bar carries the menu again — File, Edit, View, Window and Help in a row, each opening the system's own list of that menu, so Help ▸ Open the log folder and Help ▸ About are reachable again. Alt pressed alone or F10 moves focus to the row; Left and Right move between names, Enter or Down opens one, Escape goes back to the editor. The lists themselves are the system's and do not follow the colour theme. The line under the title bar now runs under the minimise, maximise and close buttons too. macOS is unchanged.
