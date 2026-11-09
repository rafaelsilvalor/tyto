---
'@tyto/plugin-api': minor
'@tyto/desktop': minor
---

A program a plugin starts now says where it runs (TYTO-569, ADR 0182 note of 2026-11-09).
`host.process.start` answers a handle with `cwd`, the absolute folder the host started it in:
the open workspace, or the home folder with none open, which a plugin hands its agent as ACP's
`session/new` `cwd`. The port's `StartedProcess` carries `cwd` too, and `checkedProcesses`
refuses and ends a program whose adapter reports none. `RPC_PROTOCOL_VERSION` is 21. The
desktop reports the folder it spawned the program in.
