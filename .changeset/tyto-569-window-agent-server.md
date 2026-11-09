---
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/command-line': minor
'@tyto/desktop': minor
---

A plugin that declares a `process:<name>` can ask for the window's MCP server and hand it to
the agent it starts (TYTO-569, ADR 0183). `host.window.agentServer()` answers
`{ name: 'tyto', command, args, env }`, the shape ACP's `session/new` takes in `mcpServers`:
the bundled Node, the relay Open an Agent Here names, and `TYTO_WINDOW` and `TYTO_HOME` only,
which the host's check enforces with a strict schema. A plugin with no program is
`E_PERMISSION`, the CLI is `E_WINDOW_UNAVAILABLE`, and the desktop refuses `agentsListen` off
(`E_WINDOW_AGENTS_OFF`) and a restricted folder (`E_WINDOW_RESTRICTED`), read at each call.
`RPC_PROTOCOL_VERSION` is 20. The install prompt's `process:` paragraph now says that the
program can also reach the Tyto window as an agent, with its edits arriving as proposals.
