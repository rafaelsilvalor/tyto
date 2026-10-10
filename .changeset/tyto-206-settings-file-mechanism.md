---
'@tyto/plugin-api': minor
'@tyto/core': minor
'@tyto/desktop': minor
---

TYTO-206 (ADR 0073): `settings.json` becomes a JSON-with-comments file the person owns. `plugin-api` gains the `configuration` extension point (`registerConfiguration`, `registry.configurations()`, `InProcessHost.configure`, `resolveSettings`), and the desktop app's four settings are declared through it by a built-in `desktop` plugin, under their existing names. Reading is tolerant one key at a time; a bad value costs that key alone and is a diagnostic with a range (`E_SETTINGS_SYNTAX`, `W_SETTING_UNKNOWN`, `W_SETTING_UNPREFIXED`, `W_SETTING_INVALID`, new in `core`). The app's screens edit the file in place, keeping comments and writing only keys that differ from their defaults, and never write a file that does not parse. The previous-version import accepts a commented `settings.json`.
