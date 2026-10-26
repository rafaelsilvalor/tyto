---
'@tyto/desktop': minor
'@tyto/io': patch
---

TYTO-371 (ADR 0138): the desktop gives installed plugins a private cache and the open folder's files. `host.cache` keeps entries in the same `TYTO_HOME` the plugins live in, and `host.workspace` reads and writes the folder open in the window, asked at every call, so a folder opened or trusted while the plugin runs is the one it sees; refusals name `Tyto desktop`. The plugins screen says in words what `workspace:read` and `workspace:write` reach. In `@tyto/io` the cache's sidecar now carries the bytes' SHA-256 and `get` answers a miss when it disagrees, so two processes racing on one key with bytes of the same size never hand back one's bytes as the other's; a sidecar written before the digest is a miss and the next `put` replaces it. One host now writes an entry in turn, and the atomic write tries a rename again while Windows says the target is busy, which an export's frames putting one key at once used to hit as `EPERM`.
