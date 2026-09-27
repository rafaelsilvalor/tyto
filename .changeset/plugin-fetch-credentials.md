---
'@tyto/plugin-api': minor
'@tyto/core': minor
'@tyto/cli': minor
---

TYTO-48: `PluginHost` gains `fetch` and `credentials` (ADR 0042). `host.fetch` reaches only the
hosts a manifest declares as `net:<host>`, `net:*.<domain>` or `net:*`, never follows a redirect,
and rejects anything else with `E_PERMISSION`; `host.credentials(key)` resolves only a
`credentials:<key>`, and in the CLI reads it from `TYTO_PLUGIN_<NAME>_<KEY>`. The check runs on
the host's side, for isolated and in-process plugins alike. Every call to an isolated plugin, and
its activation, has a 30 s deadline: past it the frame answers `E_PLUGIN_TIMEOUT`, the worker is
ended, and the timeout is recorded as a crash.
