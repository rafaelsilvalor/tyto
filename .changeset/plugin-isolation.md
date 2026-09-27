---
'@tyto/plugin-api': minor
'@tyto/pipeline': minor
'@tyto/core': minor
'@tyto/io': minor
'@tyto/cli': minor
---

TYTO-48: an installed plugin runs in a worker thread of its own, and the `PluginHost` it holds is
a proxy whose every call is a Zod-checked message (ADR 0041). `@tyto/plugin-api` gains the
protocol, the `PluginChannel` port, `runGuest` and `connectIsolatedPlugin`; `Exporter.exportFrame`
may return a `Promise`, which the job awaits. A plugin whose thread ends unasked costs the frames
waiting on it (`E_PLUGIN_CRASHED`, non-fatal) and is shown as `crashed` in `plugin list` until it
is installed or enabled again; the history is `crashes.json`, beside `plugins.json`, and
`plugins.json` now drops keys it does not know instead of refusing the file. The thread is a crash and API boundary, not a sandbox, and the
install prompt says so.
