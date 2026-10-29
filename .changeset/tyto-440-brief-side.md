---
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/cli': patch
---

TYTO-440: a plugin file's configuration sets the brief's side under `brief:` (ADR 0151). `slots` fills a slot that does not repeat when the brief leaves it unset, `formats` says what renders when the brief lists none, `skeleton` keeps the text a new brief starts with, and `editor` sets a `max` per slot, tighter than the manifest's. The brief wins every one. `@tyto/plugin-api`'s `parsePluginFile` keeps the block with each part's range (`PluginFileConfiguration.brief` is now a `ConfigurationBrief`), and warns on a key that is not one of the four. `@tyto/core`'s `resolveTemplateConfigurations` checks it against the manifest once and hands it on as `TemplateSelection.brief`; `resolve` applies it. New warnings: `W_CONFIGURATION_BRIEF_INVALID` and `W_EDITOR_RULE_LOOSER` at the plugin file's line, `W_SLOT_OVER_CONFIGURED_LIMIT` at the brief's. Nothing crosses to a plugin's process, so the protocol is unchanged. The manual's Plugins page describes it in both editions.
