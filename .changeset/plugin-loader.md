---
'@tyto/plugin-api': minor
'@tyto/pipeline': minor
'@tyto/core': minor
'@tyto/io': minor
'@tyto/cli': minor
---

TYTO-47: plugins can be installed. `tyto plugin install <folder|git-url|npm-spec>` checks the
manifest's `engine` against `PLUGIN_API_VERSION` (the plugin API's own version, ADR 0040), shows
the permissions — recorded, not yet enforced — and copies the plugin to `~/.tyto/plugins/`;
`remove`, `disable` and `enable` change what is activated, and `plugin list` gains a status column
and `--active`. `InProcessHost.tryActivate` activates an installed plugin as data rather than
throwing, and a plugin whose contribution id is taken is refused by name while the render goes on
(`W_PLUGIN_SKIPPED`). `ArtifactKind` is open, so `--types` accepts any kind an installed exporter
declares, and a document exporter's `extension` and `mime` name the file; `artifactExtension` and
`artifactMimeType` are replaced by `artifactEncoding`, and `artifactName` takes the extension.
