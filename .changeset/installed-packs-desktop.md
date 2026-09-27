---
'@tyto/core': minor
'@tyto/io': minor
'@tyto/plugin-api': minor
'@tyto/cli': patch
'@tyto/desktop': minor
---

TYTO-50: the desktop lists an installed plugin's templates in the Template picker and previews
and exports with them, searched after a chosen folder and the built-in pack and checked by the
CLI's own rule (ADR 0046), now `installedPacks` in `@tyto/io`. A plugin refused over its pack is
a row in the problems panel and is kept out of the preview, the panels and the export. Installing
a folder that holds a link no longer fails with an internal error on Windows: a link inside the
folder is copied as its target, and one that leads out or nowhere is `E_PLUGIN_LINK`, exit 1.
`PluginStore.add` answers a `Result`.
