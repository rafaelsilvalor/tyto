---
'@tyto/core': minor
'@tyto/io': minor
'@tyto/cli': patch
'@tyto/desktop': minor
'@tyto/docs': patch
'@tyto/repo-checks': patch
---

TYTO-433: the desktop fetches the templates the plugin files name (ADR 0151). Main runs the sync `tyto render` runs when the app starts, when the window opens a workspace folder, and on Plugins: Sync Plugin Files and Plugins: Update Plugin Files (`plugin-files:sync`; the update moves every ref). The fetched copies run as a plugin set of their own, beside the installed plugins, started again when a sync changes which copies load; their template packs are searched after the built-in pack and before the installed ones, offer only the templates their files name, and leave out an installed plugin a copy replaces. A failed fetch is a row in the problems panel naming the repository, and the copy fetched before keeps loading; `templates:changed` tells the window to list and compile again. A permission prompt is a native box, recorded in `plugins.json` by name. A restricted folder's plugin files are neither fetched nor loaded, and are `W_PROJECT_PLUGIN_FILES_WITHHELD` in the trust strip's count. A fetched plugin contributes templates only in the window for now. `@tyto/io` adds `syncPluginFiles`, both folders' sync moved from the CLI, with the built-in names, the path display and the permission answer as parameters, plus `machinePluginFiles`, `projectPluginFiles` and `NO_PLUGIN_FILES`; the CLI composes it unchanged. `@tyto/core` adds `W_PROJECT_PLUGIN_FILES_WITHHELD`.
