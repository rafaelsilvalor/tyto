---
'@tyto/io': minor
'@tyto/cli': minor
---

TYTO-371 (ADR 0138): the CLI implements a plugin's private cache and its workspace files. `@tyto/io` adds `pluginCache({ home })`, which keeps each entry at `TYTO_HOME/cache/plugins/<plugin>/<sha256(key)>.bin` beside a `{ key, storedAt, size }` sidecar, both written atomically and dated by the host's clock, and `workspaceFiles({ folder, trust })`, which reads the folder and its trust on every call, refuses a restricted folder with `E_WORKSPACE_FILE_RESTRICTED`, confines a path again after `realpath`, refuses a write that lands in `.tyto/` through a link, and creates the folders a write needs. `workspaceDataResolver` now shares its containment check with it. `tyto render` gives plugins both, against the brief's workspace and its trust (`--trust` counting); a brief in no workspace answers that no folder is open. `tyto watch` gives the cache only, and its refusal names it.
