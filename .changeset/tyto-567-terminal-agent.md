---
'@tyto/desktop': minor
'@tyto/command-line': minor
---

An agent started in Tyto's terminal reaches the open window (TYTO-567, ADR 0181). Terminal: Open
an Agent Here starts the program `agentCommand` names (default `claude`, with `agentArgs` after)
in a new terminal tab, told through `--mcp-config` (or Codex's `-c`) to start the window relay on
the bundled Node; Tyto installs no agent, and a missing program is a line in the tab. Every
terminal carries `TYTO_WINDOW`, which `tyto mcp --window` and the relay prefer over the folder
rule, falling back to it when that window is gone. `@tyto/command-line` gains the
`@tyto/command-line/relay` subpath export.
