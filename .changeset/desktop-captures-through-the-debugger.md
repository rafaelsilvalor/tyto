---
'@tyto/raster': patch
---

TYTO-125 — the port's comments name the mechanism the desktop actually uses

No code changes, and the `.d.ts` is why this is a release rather than nothing: `tsup` emits these
doc comments, so a consumer of `@tyto/raster` reads them. Three of them promised an offscreen
`BrowserWindow` on the desktop, which ADR 0002 named and which does not work — every route that
reads a window's composited surface returns a frame clipped to the display's work area, so a
1080×1920 story came back 1080×1680 with nothing in the bytes saying so.

ADR 0027 replaces it with `webContents.debugger`, and one consequence belongs to this package:
`RasterFormat` keeps meaning the same three things on both adapters. Electron's `NativeImage`
encodes `png` and `jpeg` and nothing else, so an Electron adapter built on it would have had to
refuse `webp`; `Page.captureScreenshot({ format: 'webp' })` returns real `RIFF`/`WEBP` bytes, and
`resolveRasterOptions` now says so where it explains why it is exported.
