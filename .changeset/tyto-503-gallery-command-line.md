---
'@tyto/command-line': minor
---

`tyto gallery list | install <id> | update <id>` (TYTO-503, ADR 0162). The index is `--index <git>` or `TYTO_GALLERY_INDEX`. `list` shows each entry as installed, update available or not installed against the machine's plugin files and lock; `install` writes it into `~/.tyto/plugin-files` pinned to its latest tag and syncs; `update` moves its ref where it lives and syncs, refusing a ref changed by hand since the gallery wrote it unless `--force`.
