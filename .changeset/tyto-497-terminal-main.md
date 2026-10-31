---
'@tyto/desktop': minor
---

The desktop app can run the person's shell in a terminal that main owns (TYTO-497, ADR 0164): PowerShell 7 or Windows PowerShell on Windows, the login shell elsewhere, or the program `terminalShell` and `terminalArgs` name in `settings.json`. A terminal starts in the open folder, or the home folder with none, and is refused while the open folder is restricted. It survives a change of folder and a reload of the window, which draws its last 256 KiB again, and ends with the app. The installers carry node-pty, the pseudo-terminal, with only the files each platform loads. No tab draws a terminal yet; the next pull request adds it.
