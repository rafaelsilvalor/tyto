---
'@tyto/command-line': minor
'@tyto/desktop': minor
---

TYTO-566: the window listens for agents (ADR 0180). It writes its record into
`TYTO_HOME/windows/`, checks each connection's token and serves the same tools as `tyto mcp`
through the new `serveAgent`. The status bar shows the agents connected, and its click cuts
them. `tyto mcp --window` is now offered. The MCP SDK is bundled into a lazy chunk of main.
