---
'@tyto/cli': minor
'@tyto/core': minor
'@tyto/io': minor
---

TYTO-456: `tyto plugin list [folder]` shows what the plugin files name, below the installed plugins: the plugin, machine or project, git, ref, the locked commit and whether a render loads it (`approved`, `not approved`, `not synced`, `refused`), then every alias as `alias → template (configuration)`. It reads the files, their lock, the cached copy's manifest and the approvals; it fetches nothing and runs no plugin. `--json` adds `pluginFiles` and `aliases`; `--active` keeps the approved copies. In a restricted workspace, `tyto render` and `tyto plugin list` name the project's `.tyto/plugin-files` as left out, in the words `tyto plugin sync` already used (ADR 0111). A plugin-file diagnostic about no file the run names (`W_PLUGIN_FILE_FETCH`, say) prints with no path instead of under the brief's name. `@tyto/core` exports `configurationAlias`, the `<template>-<configuration>` rule; `@tyto/io` exports `locationOf`. The manual's Plugins page describes the listing in both editions.
