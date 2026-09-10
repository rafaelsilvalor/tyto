import { describe, expect, it } from 'vitest';

import { createPlaywrightRasterizer } from './playwright.js';
import {
  MAX_RASTER_DIMENSION,
  rasterExtension,
  rasterMimeType,
  resolveRasterOptions,
} from './rasterizer.js';

/**
 * The port's arithmetic and its refusals, with no browser involved.
 *
 * Everything a rasterizer can decide from its arguments alone belongs here, which is why
 * `resolveRasterOptions` is exported at all: the Playwright adapter and the Electron one
 * in E5.4 have to agree on what `scale: 2` produces and on which options are nonsense,
 * and a rule tested through a browser is a rule tested once per adapter.
 *
 * The pixel work lives in `raster.visual.test.ts`, which needs Chromium on disk and runs
 * under `pnpm test:visual`.
 */

describe('resolveRasterOptions', () => {
  it('defaults to a lossless png at one device pixel per css pixel', () => {
    expect(resolveRasterOptions({ width: 1080, height: 1350 })).toEqual({
      width: 1080,
      height: 1350,
      format: 'png',
      quality: undefined,
      scale: 1,
      pixelWidth: 1080,
      pixelHeight: 1350,
    });
  });

  it('multiplies the pixels by the scale and leaves the layout alone', () => {
    const resolved = resolveRasterOptions({ width: 1080, height: 1080, scale: 2 });

    expect(resolved.width).toBe(1080);
    expect(resolved.height).toBe(1080);
    expect(resolved.pixelWidth).toBe(2160);
    expect(resolved.pixelHeight).toBe(2160);
  });

  it('rounds a fractional scale to whole pixels', () => {
    const resolved = resolveRasterOptions({ width: 101, height: 101, scale: 1.5 });

    expect([resolved.pixelWidth, resolved.pixelHeight]).toEqual([152, 152]);
  });

  it.each([
    ['zero', 0],
    ['negative', -100],
    ['fractional', 100.5],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('refuses a %s width rather than rounding it', (_label, width) => {
    expect(() => resolveRasterOptions({ width, height: 100 })).toThrow(TypeError);
  });

  it('names the option it refused, so the caller does not have to guess', () => {
    expect(() => resolveRasterOptions({ width: 100, height: 0 })).toThrow(/'height'/);
  });

  it('refuses a format Chromium cannot encode', () => {
    expect(() =>
      // The cast is the point: a JavaScript caller, or a format read from a config file,
      // gets the same refusal TypeScript already gave.
      resolveRasterOptions({ width: 10, height: 10, format: 'avif' as 'png' }),
    ).toThrow(/must be one of png, jpeg, webp/);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['not a number', Number.NaN],
  ])('refuses a %s scale', (_label, scale) => {
    expect(() => resolveRasterOptions({ width: 10, height: 10, scale })).toThrow(TypeError);
  });

  it('refuses quality on png instead of dropping it silently', () => {
    expect(() => resolveRasterOptions({ width: 10, height: 10, quality: 80 })).toThrow(
      /does not apply to png/,
    );
  });

  it.each([
    ['jpeg' as const, 80],
    ['webp' as const, 1],
    ['webp' as const, 100],
  ])('accepts quality %s at %i', (format, quality) => {
    expect(resolveRasterOptions({ width: 10, height: 10, format, quality }).quality).toBe(quality);
  });

  it.each([
    ['zero', 0],
    ['over a hundred', 101],
    ['fractional', 80.5],
  ])('refuses a %s quality', (_label, quality) => {
    expect(() => resolveRasterOptions({ width: 10, height: 10, format: 'jpeg', quality })).toThrow(
      TypeError,
    );
  });

  it('refuses a size past what Chromium will capture, and says what it added up to', () => {
    const width = MAX_RASTER_DIMENSION / 2;

    expect(() => resolveRasterOptions({ width, height: 10, scale: 4 })).toThrow(
      new RegExp(`${String(MAX_RASTER_DIMENSION * 2)}×40`),
    );
  });

  it('allows exactly the maximum', () => {
    const resolved = resolveRasterOptions({
      width: MAX_RASTER_DIMENSION,
      height: MAX_RASTER_DIMENSION,
    });

    expect(resolved.pixelWidth).toBe(MAX_RASTER_DIMENSION);
  });
});

describe('format metadata', () => {
  it('reports the media type a sink and result.json need', () => {
    expect([rasterMimeType('png'), rasterMimeType('jpeg'), rasterMimeType('webp')]).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
    ]);
  });

  it('writes jpeg files as .jpg, which is what everyone types', () => {
    expect([rasterExtension('png'), rasterExtension('jpeg'), rasterExtension('webp')]).toEqual([
      'png',
      'jpg',
      'webp',
    ]);
  });
});

describe('the Playwright adapter without a browser', () => {
  it('rejects a bad option before it launches anything', async () => {
    const rasterizer = createPlaywrightRasterizer();

    // If validation happened after the launch, this test would take a second and leave a
    // Chromium behind — which is the failure it is here to prevent.
    await expect(rasterizer.raster('<p>hi</p>', { width: 0, height: 10 })).rejects.toThrow(
      TypeError,
    );
  });

  it('closes without having opened', async () => {
    await expect(createPlaywrightRasterizer().close()).resolves.toBeUndefined();
  });
});
