---
'@tyto/core': minor
'@tyto/plugin-api': minor
---

A panel contribution may register `call(request)` (TYTO-372, ADR 0173): its page asks the
plugin's own process to do work, `{ method, params? }` in and JSON out, with the method matching
`^[a-z][\w.-]{0,99}$`, both sides at most 1 MiB of JSON and an isolated plugin's call under the
30 s deadline of every call. `@tyto/plugin-api` gains `callPanel` and `panelCallerOf`, the host's
half, which find the panel by the caller's id and refuse a request that names a plugin or a
panel; `RPC_PROTOCOL_VERSION` is 17. `@tyto/core` gains the diagnostic code `E_PANEL_CALL`. The
desktop does not offer `call` to a page yet.
