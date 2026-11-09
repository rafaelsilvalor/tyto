---
'@tyto/command-line': minor
'@tyto/desktop': patch
---

TYTO-566: `tyto mcp --window [folder]` relays an agent's stdio to a running window's local
endpoint, after reading its record in `TYTO_HOME/windows/` and sending its token (ADR 0180).
The window does not listen yet, so the option is hidden and answers that no window is open.
The desktop only gains a test: its command panel refuses `mcp --window` as it refuses `mcp`.
