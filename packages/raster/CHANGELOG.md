# @tyto/raster

## 0.2.1

### Patch Changes

- e3f2adc: TYTO-125 — the port's comments name the mechanism the desktop actually uses

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

## 0.2.0

### Minor Changes

- b7fc01a: The Playwright rasterizer launches one browser, however many rasters arrive together
  (TYTO-88).

  `browser()` did `await launching` before checking and assigning. That `await` yields the
  microtask queue even when there is nothing to await, so two concurrent callers both resumed
  with `undefined`, both fell through the guard and both launched. The second assignment won;
  `close()` shut that one down and the first stayed alive with its pipes open. A
  `tyto render --types png` of any brief with two frames wrote every artifact correctly and
  then never exited.

  Minor rather than patch because the adapter's options gained `browserType`: the browser type
  to drive instead of importing Playwright's `chromium`. It is what lets `browser-reuse.test.ts`
  count launches without a browser on disk — through a real Chromium the count is observable
  only as a process that hangs, which is why nothing caught this.

## 0.1.0

### Minor Changes

- b29a62e: Add the `Rasterizer` port and its Playwright adapter: `raster(html, { width, height, format, quality, scale })` to PNG, JPEG or WebP bytes (ADR 0002). One Chromium serves every call, a context per document carries the device scale factor, `document.fonts.ready` is awaited so an embedded `@font-face` reaches the pixels, and the background is omitted wherever the format has an alpha channel — a frame with no background comes back transparent rather than white. `playwright` is an optional peer dependency, imported when the browser launches, so depending on the port costs nothing.

  `pnpm test:visual` renders the corpus through `export-html` and diffs it against reference PNGs in Git LFS at 0.1% tolerance, one reference per fixture — the Windows and Linux renders of the corpus were measured identical at `threshold: 0`, so the per-platform key the first draft of the suite carried was dropped before merge. A missing reference fails and names the file to commit.
