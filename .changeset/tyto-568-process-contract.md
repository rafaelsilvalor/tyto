---
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/command-line': minor
---

A plugin may declare `process:<name>` and start that one program through the host (TYTO-568,
ADR 0182). The name is bare: no path, wildcard or extension. `host.process.start(name, args)`
answers a long-lived handle with `write`, `end`, `kill`, `onStdout`, `onStderr` and `exited`,
behind the optional `HostCapabilities.startProcess` port and `checkedProcesses`: an undeclared
name is `E_PERMISSION`, a host without the port (the CLI) is `E_PROCESS_UNAVAILABLE`, a third
running program is `E_PROCESS_LIMIT`, and a write after the end is `E_PROCESS_EXITED`. A
plugin's programs end when it stops. `RPC_PROTOCOL_VERSION` is 19. `@tyto/core` gains six
`E_PROCESS_*` codes, and the install prompt names each program a plugin may start. No host
starts a program yet.
