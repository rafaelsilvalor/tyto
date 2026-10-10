---
'@tyto/desktop': patch
---

TYTO-257: a new version's first run now offers the previous version's `keybindings.json` with the settings, layout and recent files, copied byte for byte, so a person's own keys keep working after an update. A file that does not parse stays behind in the older folder, as an unparsable `settings.json` does.
