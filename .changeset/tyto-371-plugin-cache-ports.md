---
'@tyto/plugin-api': minor
'@tyto/core': minor
---

TYTO-371 (ADR 0138): a plugin gets a private cache and the open workspace's files through the host. `PluginHost` gains `host.cache` — `get(key)` answers `{ bytes, storedAt }` or `undefined`, `put(key, bytes | string)` answers `{ storedAt }`, `delete(key)` whether there was an entry, `list(prefix)` `{ key, storedAt, size }[]` — which needs no permission, and `host.workspace` — `read(path)` and `write(path, bytes | string)`, which resolves to `null` — behind the new `workspace:read` and `workspace:write` permissions. `HostCapabilities` gains six optional ports (`cacheGet`, `cachePut`, `cacheDelete`, `cacheList`, `workspaceRead`, `workspaceWrite`) and an optional `hostName`; `checkedCapabilities` refuses an undeclared access, a cache key that is empty or over 1 KiB (`PLUGIN_CACHE_KEY_LIMIT_BYTES`), an entry or file over 32 MiB (`PLUGIN_FILE_LIMIT_BYTES`), a path that leaves the folder lexically and a write into `.tyto/`. `@tyto/core` adds `E_PLUGIN_CACHE`, `E_WORKSPACE_FILE` and `E_WORKSPACE_FILE_RESTRICTED`. The isolation protocol is 6. No host implements the ports yet; until one does, both answer a refusal naming the host.
