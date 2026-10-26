---
'@tyto/plugin-api': minor
'@tyto/cli': minor
---

TYTO-254 (ADR 0145): an installed plugin can declare a setting. `registerConfiguration` takes a `form` instead of a `schema` — a scalar of one type with JSON Schema's bounds, an enum, a `tyto-pattern/1` pattern, `format: 'uri'`, or a list of one scalar; no object, no secret — which the host converts with `settingSchemaOf` and validates like any setting, with the same ranged `W_SETTING_INVALID`. The `configuration` point crosses the isolation boundary as data; an isolated plugin that passes a Zod `schema` is refused by name and told to use `form`. The isolation protocol is 7: the host sends a plugin its settings in a `configure` message whenever its host is configured, `InProcessHost.configure` emits a new `configured` host event, and `host.config` in the plugin's process answers the newest. The CLI never reads the window's `settings.json`: an installed plugin's settings take their defaults there.
