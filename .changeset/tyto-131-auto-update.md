---
'@tyto/desktop': minor
---

The installed app updates itself from the newest `desktop-v*` release: it downloads in the background and installs when the app quits, after the unsaved-tabs question (Windows installer and Linux AppImage). The Windows portable and macOS show a link to the release page. A footer notice names the new version. No network or a broken feed: the app opens normally and logs one line (TYTO-131, ADR 0069).
