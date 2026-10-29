---
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/io': patch
'@tyto/cli': patch
'@tyto/desktop': patch
---

TYTO-462: a plugin file's configuration applies only to the template its entry fetched. When a project folder template, the built-in pack or another plugin wins the name, the entry configures nothing (its aliases do not load, the bare name renders with the winner's own defaults) and `W_PLUGIN_FILE_TEMPLATE_SHADOWED` says so at the entry's name in the file. In `@tyto/core`, a `TemplateRoot` may carry an `origin`, answered by the registry's `originOf`, and a `ConfiguredTemplate` may carry the `plugin` it was fetched from and its `range`. In `@tyto/plugin-api`, a `PluginFileTemplate` carries its `range`. `@tyto/io` tags each configured template with the plugin whose copy fetched it, and leaves out one no copy fetched.
