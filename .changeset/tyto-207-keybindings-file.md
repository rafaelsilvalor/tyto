---
'@tyto/desktop': minor
---

TYTO-207, PR B: "Preferences: Open Keyboard Shortcuts (JSON)" opens `keybindings.json` (beside
`settings.json`) in a tab, from the command bar or the File menu. Each entry is
`{ "key", "command", "when"? }`, and `"command": "-<id>"` removes a default binding. A save from
the tab or any editor applies with no restart, and the command bar shows the key that now works.
Unknown commands, invalid keys, unknown contexts, duplicates and attempts to take Ctrl+K away
show in the problems panel at their line while you type. A file that does not parse changes
nothing: the keys it last bound stay.
