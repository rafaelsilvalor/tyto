---
'@tyto/desktop': minor
---

An installed plugin that declares `process:<name>` can start that program (TYTO-568, ADR
0182). Main finds it on `PATH` (`.exe` before an npm `.cmd`, never `.ps1`), starts it with no
shell, or through `cmd.exe /d /s /c` for a `.cmd` with every argument `cmd.exe` would read
refused, in the open folder, with an allowlisted environment that carries no secret and adds
`TYTO_WINDOW`. A restricted folder is refused, a missing program is `E_PROCESS_NOT_FOUND`, and
every program ends when the folder or its trust changes and when the window closes. The plugins
screen names the programs each plugin may start, in English and Brazilian Portuguese.
