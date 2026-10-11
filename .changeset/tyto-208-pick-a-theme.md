---
'@tyto/desktop': minor
---

TYTO-208 (ADR 0077): a person chooses the colour theme. The new `theme` setting is one theme id or `{ mode: "system" | "light" | "dark", light, dark }`; `mode: "light"` or `"dark"` overrides the system for the window, the editor and the native dialogs, and a save of `settings.json` applies it with no restart. "Preferences: Color Theme" in Ctrl+K lists every theme with its kind, previews the highlighted one, writes the choice on Enter and puts the previous theme back on Escape. Installed plugins' themes are read from their folders and can be chosen; a theme file that cannot be used is a row in the problems panel, and the built-in theme of its kind applies.
