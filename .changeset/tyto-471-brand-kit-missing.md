---
'@tyto/desktop': minor
---

A plugin file's configuration that names a brand no started plugin's kit offers is now a `W_BRAND_KIT_MISSING` row in the problems panel, placed at its `brand:` line, as `tyto render` already says it (TYTO-471, ADR 0155). It is said once the installed plugins have started, and again after every sync of the plugin files.
