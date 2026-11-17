---
'@tyto/plugin-api': minor
'@tyto/io': minor
'@tyto/desktop': patch
'@tyto/command-line': patch
---

A plugin with `workspace:read` can read a workspace file of any size in parts with
`host.workspace.read(path, { offset, length })`, and stat and list the open folder with
`host.workspace.stat(path)` and `host.workspace.list(path)` (ADR 0212). The plugin protocol is
now 27.
