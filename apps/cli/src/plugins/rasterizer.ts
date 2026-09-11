import type { Plugin } from '@tyto/plugin-api';
import { type Rasterizer, createPlaywrightRasterizer } from '@tyto/raster';

/**
 * The `rasterizer` extension point's built-in, and the only module in this app that names
 * a Chromium.
 *
 * ADR 0010 keeps adapters out of every package and in the composition root; ADR 0007 adds
 * that even a built-in reaches the host through the same door a third party would. This
 * file is where those two meet: `createPlaywrightRasterizer` is imported here and nowhere
 * else, and what leaves is a contribution with an id.
 */

/** A `Rasterizer` that may own a browser; `close` is not part of the port. */
export type CloseableRasterizer = Rasterizer & { close?: () => Promise<void> };

/**
 * Playwright's Chromium, unlaunched.
 *
 * A factory rather than an instance, so a command with nothing to raster never pays for a
 * browser. It may throw — a machine without `playwright` installed is exactly that — and
 * that throw is an internal failure (exit 2), not a diagnostic about anybody's brief.
 */
export function defaultRasterizer(): CloseableRasterizer {
  return createPlaywrightRasterizer();
}

export function rasterizerPlugin(rasterizer: Rasterizer, id = 'chromium'): Plugin {
  return {
    id,
    activate: (host) => host.registerRasterizer<Rasterizer>({ id, value: rasterizer }),
  };
}
