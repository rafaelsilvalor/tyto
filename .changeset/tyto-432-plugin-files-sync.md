---
'@tyto/cli': minor
'@tyto/core': minor
'@tyto/io': minor
'@tyto/plugin-api': minor
---

TYTO-432: the CLI fetches what the plugin files name (ADR 0151). `tyto plugin sync` reads `~/.tyto/plugin-files/*.yaml` and a trusted workspace's `.tyto/plugin-files/*.yaml`, fetches each source with the person's own `git` into `~/.tyto/cache/plugin-files/`, and pins the commit in `plugin-files.lock.json`; `--update` moves a branch, and nothing else does. `tyto render` runs the same sync without moving anything, so it reaches the network only for a copy that is missing, and loads each copy as an installed plugin. A source that cannot be reached loads the copy fetched before and says so. `tyto plugin clean` deletes the copies no lock names. `@tyto/plugin-api` gains the plugin-file parser and the lock's schema, `@tyto/io` the fetch, cache and lock adapters, and `@tyto/core` the `*_PLUGIN_FILE_*` diagnostic codes.
