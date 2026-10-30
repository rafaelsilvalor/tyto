import type { Plugin } from '@tyto/plugin-api';
import type { Rasterizer } from '@tyto/raster';

/**
 * The manifests, imported rather than declared.
 *
 * Named `<id>.tyto-plugin.json` and not `tyto-plugin.json`, which is the one place these
 * built-ins differ from a third party's: a plugin package puts the file at its root, and
 * these four have no package of their own yet — they are the composition root's wiring
 * around `@tyto/raster`, `@tyto/io` and `@tyto/templates`. Four files cannot share one
 * name in one folder. The document inside is the same document, validated by the same
 * schema, and the day one of them gets a package the file moves to that package's root
 * under the ordinary name.
 */
import manifest from './chromium.tyto-plugin.json';

/**
 * The `rasterizer` extension point's built-in.
 *
 * ADR 0010 keeps the choice of adapter in the composition root; ADR 0007 adds that even a
 * built-in reaches the host through the same door a third party would. So the Chromium is the
 * app's (`environment.rasterizer()`: Playwright in a terminal, the hidden window in the app),
 * and what this file adds is the contribution with an id that wraps it.
 */

/** A `Rasterizer` that may own a browser; `close` is not part of the port. */
export type CloseableRasterizer = Rasterizer & { close?: () => Promise<void> };

export function rasterizerPlugin(rasterizer: Rasterizer): Plugin {
  const id = manifest.name;

  return {
    id,
    manifest,
    activate: (host) => host.registerRasterizer<Rasterizer>({ id, value: rasterizer }),
  };
}
