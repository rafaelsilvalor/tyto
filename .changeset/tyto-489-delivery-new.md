---
'@tyto/core': minor
'@tyto/io': minor
'@tyto/cli': minor
'@tyto/editor': patch
---

`tyto delivery new <name> [--template <name>]` makes a delivery: one folder per piece of work, named after its ticket, with `assets/`, `editaveis/` and the brief as `editaveis/<name>.brief` (TYTO-489, ADR 0157). The project file and a work profile gain the `delivery` key (`parent`, `folders`, `brief`, `exports`, `formats`, `types`), merged one subkey at a time; `parent` stays inside the workspace folder for every sheet. An existing delivery folder is reused, an existing brief is refused with `E_DELIVERY_BRIEF_EXISTS` and nothing written, and a name a folder cannot have is `W_DELIVERY_NAME_INVALID` (ADR 0114's profile rule, up to 100 characters, NFC). `@tyto/core` now holds `briefSkeleton` and `skeletonText`, which `@tyto/editor` re-exports unchanged.
