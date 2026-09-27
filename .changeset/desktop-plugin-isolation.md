---
'@tyto/plugin-api': minor
'@tyto/cli': patch
'@tyto/desktop': minor
---

TYTO-48: the desktop runs installed, enabled plugins, each in a `utilityProcess` of its own, and
activates them into every export's host, so an installed exporter's kind is offered by the export
dialog (`export:kinds`) and exported from it (ADR 0044). `host.fetch` goes through `net.fetch`
without following redirects; `host.credentials` reads only the keychain entry
`plugin:<name>:<key>` through `safeStorage`, and answers `E_CREDENTIAL_MISSING` until the app
has a screen to store one. A crashed plugin is shown as `crashed` on the plugins screen. The
queue stays PNG-only by decision. `@tyto/plugin-api` gains `startInstalledPlugins`,
`readInstalledPlugins`, `writeCrash` and `activateInstalled`, the loader both apps now share.
