import type { Browser, BrowserType, LaunchOptions } from 'playwright';

import {
  type RasterOptions,
  type Rasterizer,
  type ResolvedRasterOptions,
  resolveRasterOptions,
} from './rasterizer.js';

/**
 * The `Rasterizer` for the CLI and the cloud: Playwright driving Chromium (ADR 0002).
 *
 * One browser serves every call. Launching Chromium costs a few hundred milliseconds and
 * a job renders artworks × formats documents, so a launch per document would dominate the
 * run; a context per document costs almost nothing and is what keeps one render from
 * seeing another's state. The browser is launched on the first `raster` and reused until
 * `close`.
 *
 * `playwright` is an optional peer dependency, imported dynamically at launch. The
 * desktop app implements the same port with an offscreen `BrowserWindow` (E5.4) and has
 * no use for a second Chromium on disk — so importing `@tyto/raster` costs nothing until
 * somebody actually asks for this adapter, and a missing `playwright` reports itself as
 * one sentence about installing it rather than a module that will not resolve.
 */

/**
 * Flags that make two machines agree.
 *
 * `Determinism: same brief + templates + fonts ⇒ same bytes` (`docs/architecture.md`) is
 * a claim about one machine over time, and these are what stretch it towards being a
 * claim about two machines at once. Each one turns off something whose result depends on
 * the host rather than on the document:
 *
 * - `--force-color-profile=srgb` — otherwise Chromium converts to the display's profile,
 *   and the same `#ff5900` comes out as different bytes on a wide-gamut monitor.
 * - `--font-render-hinting=none` and `--disable-lcd-text` — hinting and subpixel
 *   antialiasing are the host's font stack talking. Greyscale, unhinted glyphs are the
 *   closest thing to platform-independent text Chromium offers.
 * - `--disable-gpu` — a GPU compositor rasterizes gradients and filters differently from
 *   the software one, and which one runs depends on the machine.
 * - `--hide-scrollbars` — a scrollbar is 15 px of the frame's width on one platform and
 *   0 on another.
 *
 * They are not enough to make a reference PNG portable across operating systems — text
 * rasterization is still FreeType on Linux and Skia-over-DirectWrite on Windows, which is
 * why `visual.test.ts` keys its references on `process.platform`. They are enough to make
 * one platform's reference stable.
 */
export const DETERMINISM_ARGS: readonly string[] = [
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--disable-gpu',
  '--hide-scrollbars',
];

export interface PlaywrightRasterizerOptions {
  /**
   * A Chromium channel to use instead of Playwright's own build — `'chrome'` renders in
   * the Chrome already installed on the machine.
   *
   * For a developer who has not run `playwright install`, not for CI: a channel is
   * whatever version the machine happens to have, and reference bytes are only
   * comparable against the build that produced them.
   */
  readonly channel?: string;
  /** An explicit browser binary, for a sandbox that has one in an unusual place. */
  readonly executablePath?: string;
  /** Appended to {@link DETERMINISM_ARGS}. */
  readonly args?: readonly string[];
  /** Passed through to `chromium.launch`; a CI container usually wants `--no-sandbox`. */
  readonly launch?: LaunchOptions;
}

export interface PlaywrightRasterizer extends Rasterizer {
  /**
   * Shuts the browser down. Idempotent, and a `raster` after it launches a new one — a
   * long-lived process that closes between jobs should not have to hold a different
   * object afterwards.
   */
  close(): Promise<void>;
}

/**
 * `document.fonts.ready` as a string, because it is not this package's `document`.
 *
 * The expression runs in the page. Writing it as a closure would put the identifier
 * `document` in a Node package, which the boundary rules in `eslint.config.js` reject
 * with a message about the renderer — correctly, since a reader has no way to tell from
 * the identifier alone which side of the process it runs on. A string cannot be mistaken
 * for local code.
 *
 * Waiting for it is the difference between an embedded `@font-face` and the fallback
 * font: `waitUntil: 'load'` resolves when the stylesheet has loaded, not when the faces
 * it declares have been decoded.
 */
const FONTS_READY = 'document.fonts.ready';

/**
 * A rasterizer backed by Playwright's Chromium.
 *
 * The browser is not launched here — a caller that builds one of these and then finds
 * nothing to render should not have paid for a browser.
 */
export function createPlaywrightRasterizer(
  options: PlaywrightRasterizerOptions = {},
): PlaywrightRasterizer {
  // The promise, not the browser: two `raster` calls that arrive before the first launch
  // finishes have to await the same launch, or the second one starts a browser nobody
  // will ever close.
  let launching: Promise<Browser> | undefined;

  async function chromium(): Promise<BrowserType> {
    try {
      const playwright = await import('playwright');
      return playwright.chromium;
    } catch (cause) {
      throw new Error(
        "The Playwright rasterizer needs the optional peer dependency 'playwright'. " +
          "Install it, then run 'playwright install chromium' to fetch the browser.",
        { cause },
      );
    }
  }

  async function launch(): Promise<Browser> {
    const browserType = await chromium();
    return browserType.launch({
      ...options.launch,
      ...(options.channel === undefined ? {} : { channel: options.channel }),
      ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
      args: [...DETERMINISM_ARGS, ...(options.args ?? [])],
    });
  }

  async function browser(): Promise<Browser> {
    const existing = await launching;
    if (existing?.isConnected() === true) return existing;
    // A browser that died — crashed, or killed with the terminal it was started from —
    // is not an error the next render has to inherit.
    launching = launch();
    return launching;
  }

  async function capture(html: string, resolved: ResolvedRasterOptions): Promise<Uint8Array> {
    const instance = await browser();
    const context = await instance.newContext({
      viewport: { width: resolved.width, height: resolved.height },
      deviceScaleFactor: resolved.scale,
      // The document decides what it looks like. A `prefers-color-scheme` or
      // `prefers-reduced-motion` that varied with the host would be the machine having an
      // opinion about the artwork.
      colorScheme: 'light',
      reducedMotion: 'reduce',
      forcedColors: 'none',
    });

    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(FONTS_READY);

      const buffer = await page.screenshot({
        type: resolved.format,
        ...(resolved.quality === undefined ? {} : { quality: resolved.quality }),
        // Always, except where the format has no alpha to omit it into. A frame that
        // wants a background paints one in the HTML (`docs/ir-schema.md`: "Frame without
        // background → omitBackground in raster"), so omitting Chromium's white is never
        // wrong — it either reveals the frame's own paint or leaves the transparency the
        // brief asked for. JPEG has no alpha channel, and Chromium composites on white.
        omitBackground: resolved.format !== 'jpeg',
        animations: 'disabled',
        // `device`, so `deviceScaleFactor` reaches the bytes. Under `css` a 2x export
        // would come back at 1x and the option would silently do nothing.
        scale: 'device',
      });

      return new Uint8Array(buffer);
    } finally {
      await context.close();
    }
  }

  return {
    async raster(html: string, rasterOptions: RasterOptions): Promise<Uint8Array> {
      return capture(html, resolveRasterOptions(rasterOptions));
    },

    async close(): Promise<void> {
      const pending = launching;
      launching = undefined;
      const instance = await pending;
      await instance?.close();
    },
  };
}
