---
'@tyto/plugin-api': minor
'@tyto/export-html': minor
'@tyto/export-svg': minor
'@tyto/core': minor
---

TYTO-35 validate `tyto-plugin.json` and list what is installed

`@tyto/plugin-api` gains `pluginManifestSchema`, `parsePluginManifest` and
`validatePluginManifest`: the manifest of `docs/plugin-api.md` as a schema, rejecting with
a field path (`contributes.1`, `config.$schema`) and reporting every problem at once.

`InProcessHost.activate(plugin, origin?)` is the door a plugin now comes through. It
validates the manifest, refuses a `name` that disagrees with the plugin's id, refuses a
contribution to a point the manifest did not declare, and records the plugin so
`registry.plugins()` can list it.

`Plugin` therefore carries a `manifest`, typed `unknown` because a manifest is a document
to be validated rather than a shape to be trusted. Both exporters ship a real
`tyto-plugin.json` at their package root and export it as `htmlExporterManifest` /
`svgExporterManifest`. The unused `id` option is gone from both plugin factories: the
manifest's `name` is the id, and a second name for one plugin is a second thing to keep in
step.

`@tyto/core` adds `E_PLUGIN_MANIFEST_SYNTAX` and `E_PLUGIN_MANIFEST_SHAPE`.
