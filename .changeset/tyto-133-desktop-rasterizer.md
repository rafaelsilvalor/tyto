---
'@tyto/desktop': minor
---

TYTO-133 — the desktop can turn artwork into image bytes.

`createDebuggerRasterizer` implements the `Rasterizer` port on a hidden `BrowserWindow`
captured through `webContents.debugger` (ADR 0027), registered through the plugin host under
the same `chromium` id the CLI uses for its Playwright one. All three formats the port
promises come back with the right container, and `scale` reaches the pixels rather than the
layout.

A `minor` and not a `patch`: nothing the window does today changes, but the app gained a
capability it did not have, and the next card is the one that puts a button in front of it.
