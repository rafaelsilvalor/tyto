# @tyto/raster

## 0.1.0

### Minor Changes

- b29a62e: Add the `Rasterizer` port and its Playwright adapter: `raster(html, { width, height, format, quality, scale })` to PNG, JPEG or WebP bytes (ADR 0002). One Chromium serves every call, a context per document carries the device scale factor, `document.fonts.ready` is awaited so an embedded `@font-face` reaches the pixels, and the background is omitted wherever the format has an alpha channel — a frame with no background comes back transparent rather than white. `playwright` is an optional peer dependency, imported when the browser launches, so depending on the port costs nothing.

  `pnpm test:visual` renders the corpus through `export-html` and diffs it against reference PNGs in Git LFS at 0.1% tolerance, one reference per fixture — the Windows and Linux renders of the corpus were measured identical at `threshold: 0`, so the per-platform key the first draft of the suite carried was dropped before merge. A missing reference fails and names the file to commit.
