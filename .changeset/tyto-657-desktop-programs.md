---
'@tyto/desktop': minor
---

TYTO-657, ADR 0184: the desktop runs a plugin's own program and opens a terminal for it. A
program the manifest's `programs` maps to a script is run on the bundled Node from the plugin's
own folder, after the script's real path is checked to lie inside it
(`E_PROCESS_SCRIPT_MISSING` otherwise), under every rule of ADR 0182. `host.terminal.open`
opens a Terminal tab running a declared program in the open folder: main starts it, the window
adopts it through the new `terminal:opened` event and `terminal:list`, and the plugin hears
only that it opened. The plugins screen names a plugin's own programs on a line of their own
and says it may open a terminal tab; the user manual says the same in both editions.
