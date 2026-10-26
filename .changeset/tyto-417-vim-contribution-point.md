---
'@tyto/plugin-api': minor
'@tyto/editor': minor
'@tyto/core': minor
---

TYTO-417 (ADR 0141): a plugin contributes vim mappings through a new `editor.vim` point, the seventeenth. `registerVim({ id, title?, mappings, ex? })` registers data only: each mapping binds `keys`, in an optional vim `context`, to an `operation` named by `@tyto/editor`, with optional `args`; each ex command runs a command id. It crosses an isolated plugin's boundary as data, and `registry.vim()` lists it. In `@tyto/editor`, `defineVimOperation(name, { kind: 'action' | 'operator', run })` names an operation and `setVimContributions(contributions, enabledIds)` maps the enabled contributions into the engine and unmaps the rest, per window and idempotently, so a switched-off key does what vim does by default again. A contribution that cannot be applied is left out whole with `E_VIM_CONTRIBUTION`, a new code in `@tyto/core`.
