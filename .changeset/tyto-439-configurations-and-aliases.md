---
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/io': minor
'@tyto/pipeline': minor
'@tyto/cli': minor
---

TYTO-439: plugin files resolve configurations and aliases (ADR 0151, ADR 0153). A configuration in `~/.tyto/plugin-files/*.yaml` or a trusted workspace's `.tyto/plugin-files/*.yaml` is reached by its alias — `<template>-<configuration>` when the file writes none — and the entry's `default` by the template's own name; every other configuration starts from the `default`. `tyto render` and `tyto watch` render an alias as its template with that configuration's values, the template's defaults under them and a caller's over them. A fetched pack offers only the templates its files name. `@tyto/core` adds `resolveTemplateConfigurations`, the `TemplateConfigurations` a `resolve` and a job look a name up in first, `ResolvedBrief.configuration` and `values`, `TemplateRoot` (`loadTemplateRegistry` takes a root that offers only some names) and `E_TEMPLATE_ALIAS_TAKEN`; each value is checked once, in the file that wrote it. `@tyto/plugin-api` keeps a range per configuration value, adds `configuredTemplates`, and carries `values` in a template call: **the isolation protocol is 10**, so a plugin process on 9 is refused at `hello`, and a manifest whose `engine` asks for `^0.7` is refused by this release's engine check until its range moves. `@tyto/io` adds `pluginFileImages`, which reads an image path relative to its file and keeps it inside the workspace or `TYTO_HOME`, `SyncedFolder.files` and `InstalledPacks.owners`. `@tyto/pipeline`'s `JobPorts` takes `configurations`.
