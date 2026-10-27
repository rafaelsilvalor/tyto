---
'@tyto/desktop': minor
'@tyto/core': minor
---

TYTO-254 (ADR 0145): an installed plugin's settings work in the desktop. `settings.json` is checked against the built-ins' settings and the installed plugins' together, so `<plugin>.<key>` is suggested in the settings tab, checked with a ranged `W_SETTING_INVALID`, and delivered to the plugin's process: the window's plugin host is configured on every reading, and each export's host before the installed plugins are activated into it. The tab's validation, its outline and the launch log wait for the installed plugins to start, and the file is read again then. A key of an installed plugin that is disabled, failed or refused is the new warning `W_SETTING_PLUGIN_NOT_RUNNING`, which names the plugin, instead of `W_SETTING_UNKNOWN`.
