/**
 * @tyto/raster — the `Rasterizer` port and its Chromium adapters.
 *
 * Playwright for the CLI, an offscreen BrowserWindow for the desktop app. Swapping in a
 * containerised backend later must not touch a single pure package.
 *
 * The port is types and arithmetic; `playwright` is an optional peer dependency the
 * adapter imports when it launches, so depending on this package does not put a browser
 * on disk. `docs/architecture.md` (Strategy, raster stage), ADR 0002.
 */

export {
  MAX_RASTER_DIMENSION,
  type RasterFormat,
  type RasterOptions,
  type Rasterizer,
  type ResolvedRasterOptions,
  rasterExtension,
  rasterMimeType,
  resolveRasterOptions,
} from './rasterizer.js';

export {
  DETERMINISM_ARGS,
  type PlaywrightRasterizer,
  type PlaywrightRasterizerOptions,
  createPlaywrightRasterizer,
} from './playwright.js';
