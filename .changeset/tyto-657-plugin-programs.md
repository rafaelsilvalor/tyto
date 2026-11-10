---
'@tyto/plugin-api': minor
'@tyto/core': minor
'@tyto/command-line': minor
---

TYTO-657, ADR 0184: a plugin may ship its own program and open a terminal for it. A manifest's
new `programs` maps a declared `process:<name>` to a script inside the plugin's folder, which
the host runs on its bundled Node instead of looking the name up on `PATH`; the port's
`startProcess` receives that script as a fifth argument. `host.terminal.open(name, args)` asks
the host for a terminal tab running a declared program, one open at a time
(`PLUGIN_TERMINAL_LIMIT`), behind `checkedTerminal` and the optional port
`HostCapabilities.openTerminal`. New codes `E_PROCESS_SCRIPT_MISSING`, `E_TERMINAL_UNAVAILABLE`
and `E_TERMINAL_LIMIT`. `RPC_PROTOCOL_VERSION` is 22. The install prompt says when a program is
the plugin's own code, what still holds it and what does not, and that the plugin may open a
terminal tab running its programs.
