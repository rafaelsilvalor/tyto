---
'@tyto/plugin-api': minor
'@tyto/core': patch
'@tyto/desktop': minor
---

A plugin that declares `window:tools` lists and calls the window's tools in process with
`host.window.tools()` and `host.window.callTool(name, input)` (ADR 0190): the same server an agent
connected to the window reaches, under the same trust, `agentsListen` and restricted-folder
refusals, with edits as proposals. The isolation protocol is 23. `E_WINDOW_UNAVAILABLE`,
`E_WINDOW_AGENTS_OFF` and `E_WINDOW_RESTRICTED` now say "asked to reach the window".
