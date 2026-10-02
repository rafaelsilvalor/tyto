import type { AssetRef, Size } from '@tyto/core';

import type { ExportResources } from './export-resources.js';

/**
 * Several sources of export bytes, asked in order: the first that answers a ref wins.
 *
 * The one place the brief's files and the template's are put together. The CLI and the
 * window each wrote this twice, and the copies drifted: the CLI's dropped `assetSize`, so
 * `tyto render` stopped cropping a `cover` image while the window kept cropping it
 * (TYTO-215). One function means a field forgotten here is forgotten by both programs, and
 * their tests say so together (TYTO-216).
 *
 * Only a combiner. It reads nothing and loads no font: each layer is a resolver somebody
 * else built, and a caller that has a font library adds `font` to the halves itself.
 *
 * `layers` is read on every call, not copied. A template's resources are only known once
 * the job has loaded the template, so a caller hands over a list it fills later — and
 * `runJob` asks an exporter for bytes only after its template stage has run.
 *
 * `asset` answers both halves from the HTML half, as both copies did: a data URI is the
 * same string for either exporter. `assetSize` goes to the SVG half only, because HTML
 * crops with `object-fit` and the SVG exporter writes the crop itself (TYTO-60).
 */
export function layeredExportResources(
  layers: readonly (ExportResources | undefined)[],
): ExportResources {
  const asset = (ref: AssetRef): string | undefined => {
    for (const layer of layers) {
      const found = layer?.html?.asset?.(ref);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const assetSize = (ref: AssetRef): Size | undefined => {
    for (const layer of layers) {
      const found = layer?.svg?.assetSize?.(ref);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return { html: { asset }, svg: { asset, assetSize } };
}
