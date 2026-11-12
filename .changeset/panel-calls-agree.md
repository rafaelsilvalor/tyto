---
'@tyto/plugin-api': minor
'@tyto/core': patch
'@tyto/desktop': patch
---

A panel's call now reaches its own plugin by plugin and panel id together, and answers the same
in process as isolated (TYTO-644, ADR 0173). **Breaking for a host calling these directly:**
`panelCallerOf(registry)` now returns `(plugin, panelId, request)` instead of
`(panelId, request)`, and reads the registry's new `ownedPanels()`, so two plugins that each
contribute a `settings` panel can no longer reach each other's; `callPanel(panel, request,
plugin)` takes the contributing plugin's name as a third argument. An in-process `call` whose
answer the isolation protocol refuses — `{ ok: true, value }` without `diagnostics`, a value
over 1 MiB or not JSON, anything that is not a result — is refused as `E_PLUGIN_PROTOCOL`
naming the plugin, exactly as the same plugin running isolated, rather than passed (missing
`diagnostics`) or refused as `E_PANEL_CALL`. The isolation protocol does not change.
`@tyto/core` updates the `E_PANEL_CALL` and `E_PLUGIN_PROTOCOL` summaries to match; the
desktop passes the panel's plugin to `callPanel`.
