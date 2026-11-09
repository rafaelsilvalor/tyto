---
'@tyto/desktop': minor
---

TYTO-651: verification mode. Started with Chromium's `--remote-debugging-port`, the window draws
"Verification mode · port N" first on the status bar, outside the `statusBarItems` list, and
main logs a warning; the port listens on 127.0.0.1 only. `scripts/verify.ts` connects over CDP
and prints the window's screenshot path, text, tabs, plugins with credentials as set or not set,
and, only when named, a recipe's Run with each cell's status and plan lines.
