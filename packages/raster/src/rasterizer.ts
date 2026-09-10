/**
 * The `Rasterizer` port: HTML in, image bytes out (`docs/architecture.md`, ADR 0002).
 *
 * The stage after an exporter. It takes the self-contained document `export-html` built
 * — fonts and assets already embedded, no network requests — and hands back the bytes of
 * one image. Nothing in it knows about a `Scene`, a brief or a file: a rasterizer is
 * handed a string and a size, which is what lets the same port be served by Playwright on
 * the CLI, an offscreen `BrowserWindow` on the desktop and a container in the cloud.
 *
 * This module is types and arithmetic only — no Node, no DOM — so a consumer can depend
 * on the contract without dragging a browser in. The adapters are the parts that pick a
 * runtime.
 *
 * **Rejections, not `Result`.** `docs/conventions.md` makes `Result<T, Diagnostic[]>` the
 * answer for expected errors, and a browser that will not launch is not one of them: it
 * is the operating system's answer, the same category as the unreadable path
 * `core`'s `FileSystem` port deliberately rejects on. The caller that owns a user-facing
 * edge — `pipeline` in E6.1 — catches and writes the diagnostic. What *is* predictable
 * from the arguments alone is a programmer error, and `resolveRasterOptions` throws
 * `TypeError` for it rather than inventing a diagnostic code for a bug no brief can
 * cause.
 */

/**
 * The image formats a rasterizer produces.
 *
 * The three Chromium can encode. `png` is the only lossless one and the only one with an
 * alpha channel that survives — which is why a frame without a background has to be
 * exported as PNG or WebP for the transparency to mean anything.
 */
export type RasterFormat = 'png' | 'jpeg' | 'webp';

export interface RasterOptions {
  /** Frame width in CSS pixels. A positive integer; `scale` multiplies it. */
  readonly width: number;
  /** Frame height in CSS pixels. A positive integer; `scale` multiplies it. */
  readonly height: number;
  /** Defaults to `png`. */
  readonly format?: RasterFormat;
  /**
   * Encoder quality, 1–100, for `jpeg` and `webp` only.
   *
   * Passing it with `png` is a `TypeError` rather than a value quietly dropped: PNG is
   * lossless, and a caller who thinks it asked for a smaller file deserves to hear that
   * it did not.
   */
  readonly quality?: number;
  /**
   * Device scale factor. Defaults to 1; `2` is the retina export.
   *
   * It multiplies the pixels, not the layout — a 2x export is the same design at twice
   * the resolution, not a design given twice the room.
   */
  readonly scale?: number;
}

/** `RasterOptions` with the defaults filled in, which is what an adapter works from. */
export interface ResolvedRasterOptions {
  readonly width: number;
  readonly height: number;
  readonly format: RasterFormat;
  readonly quality: number | undefined;
  readonly scale: number;
  /** `width × scale`, the width of the bytes that come back. */
  readonly pixelWidth: number;
  /** `height × scale`, the height of the bytes that come back. */
  readonly pixelHeight: number;
}

export interface Rasterizer {
  /**
   * The bytes of `html` rendered at the requested size.
   *
   * `html` must already be self-contained. A rasterizer offers no resolver and opens no
   * files, because a document that still needs fetching would render differently
   * depending on what the network did that second, and ADR 0018 already put the bytes
   * inside the document.
   */
  raster(html: string, options: RasterOptions): Promise<Uint8Array>;
}

/**
 * Chromium refuses to capture past this on either axis, so the port refuses first.
 *
 * A guard rather than a preference: `scale: 1000` on a feed frame is a typo that would
 * otherwise reach the browser as an out-of-memory crash, and a crash does not name the
 * argument that caused it.
 */
export const MAX_RASTER_DIMENSION = 16_384;

const FORMATS: readonly RasterFormat[] = ['png', 'jpeg', 'webp'];

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(
      `Rasterizer option '${name}' must be a positive integer, got ${String(value)}. ` +
        'Rounding is the caller’s decision: a size silently rounded here would not be ' +
        'the size it asked for.',
    );
  }
  return value;
}

/**
 * `RasterOptions` with defaults applied, or a `TypeError` naming what is wrong.
 *
 * Exported because every adapter has to agree on it. The Electron one in E5.4 has to
 * produce the same bytes as this one within tolerance, and two adapters that each decide
 * for themselves what `quality: 0` means have already stopped agreeing.
 */
export function resolveRasterOptions(options: RasterOptions): ResolvedRasterOptions {
  const width = positiveInteger('width', options.width);
  const height = positiveInteger('height', options.height);

  const format = options.format ?? 'png';
  if (!FORMATS.includes(format)) {
    throw new TypeError(
      `Rasterizer option 'format' must be one of ${FORMATS.join(', ')}, got '${String(format)}'.`,
    );
  }

  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new TypeError(
      `Rasterizer option 'scale' must be a finite number greater than 0, got ${String(scale)}.`,
    );
  }

  const { quality } = options;
  if (quality !== undefined) {
    if (format === 'png') {
      throw new TypeError(
        "Rasterizer option 'quality' does not apply to png, which is lossless. Ask for " +
          "format 'jpeg' or 'webp', or drop the option.",
      );
    }
    if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
      throw new TypeError(
        `Rasterizer option 'quality' must be an integer from 1 to 100, got ${String(quality)}.`,
      );
    }
  }

  // Rounded, because a device scale factor of 1.5 on an odd width is a fraction of a
  // pixel and the browser has to land on a whole one anyway. The rule is stated here so
  // that both adapters round the same way rather than each inheriting its runtime's.
  const pixelWidth = Math.round(width * scale);
  const pixelHeight = Math.round(height * scale);
  if (pixelWidth > MAX_RASTER_DIMENSION || pixelHeight > MAX_RASTER_DIMENSION) {
    throw new TypeError(
      `Rasterizing ${String(width)}×${String(height)} at scale ${String(scale)} asks for ` +
        `${String(pixelWidth)}×${String(pixelHeight)} pixels, past the ` +
        `${String(MAX_RASTER_DIMENSION)} Chromium will capture on either axis.`,
    );
  }

  return { width, height, format, quality, scale, pixelWidth, pixelHeight };
}

/** The media type of the bytes a format produces, for `result.json` and for an HTTP edge. */
export function rasterMimeType(format: RasterFormat): string {
  return `image/${format}`;
}

/** The file extension a format is written with, without the dot (`docs/git-workflow.md`). */
export function rasterExtension(format: RasterFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}
