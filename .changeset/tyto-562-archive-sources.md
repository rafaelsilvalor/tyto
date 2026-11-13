---
'@tyto/plugin-api': minor
'@tyto/io': minor
'@tyto/command-line': minor
'@tyto/core': patch
'@tyto/desktop': patch
---

A plugin file source may be an `archive`: a `.zip` over https or on the machine, with `{ref}`
in its location, fetched without Git and pinned in the lock by the sha256 of its bytes
(ADR 0197). `PluginFilesCopy` names `location` and `pin` in place of `git` and `commit`.
