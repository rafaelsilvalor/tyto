---
'@tyto/plugin-api': minor
'@tyto/io': minor
'@tyto/desktop': minor
---

Every program the desktop starts for a plugin is told the plugin's data folder in
`TYTO_PROGRAM_DATA` (`PROGRAM_DATA_VARIABLE`, ADR 0187): `~/.tyto/data/plugins/<name>`, created at
the first start that passes every refusal, kept across the plugin's updates and deleted when the
plugin is removed (`pluginDataDirectory`, `fsPluginStore.remove`).
