---
'@tyto/desktop': minor
---

The status bar shows what `statusBarItems` in `settings.json` lists, in that order inside each
side: `leftArea`, `commandBar`, `vimMode`, `cursorPosition`, `tabKind`, `template`, `problems`,
`queue`, `plugins`, `export`, `settings`, `bottomArea`, `rightArea`. Leave an id out to hide that
item; saving the file applies it with no restart. Without the setting the bar is exactly as
before. An unknown or repeated id is a warning at that entry and the rest still apply. A new
`settings.json` carries the key commented out, with every id and what it is.
