---
'@tyto/desktop': patch
---

The packaged app no longer opens a debugger on its main process when started with `--inspect`
(TYTO-249, ADR 0067). Electron's `EnableNodeCliInspectArguments` fuse is off, so a program on the
same machine can no longer run code in main that way. The packaged test suite now drives the app
over the Chrome DevTools Protocol and quits it through the quit guard.
