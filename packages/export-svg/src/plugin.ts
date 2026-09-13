import type { Plugin } from '@tyto/plugin-api';

/**
 * The manifest, imported rather than declared.
 *
 * `tyto-plugin.json` at the package root is the same file a third-party plugin ships, and
 * the host validates it with the same schema (`docs/plugin-api.md`). Importing it keeps
 * one copy: the version below is the package's own, and a manifest declared in TypeScript
 * beside the code would be a second place for it to be wrong.
 */
import manifest from '../tyto-plugin.json';

import type { SvgResources } from './defs.js';
import { exportFrameSvg } from './export-svg.js';

/**
 * This exporter, as the plugin it is (ADR 0007, `docs/plugin-api.md`).
 *
 * The twin of `htmlExporterPlugin`, and the reason the pair is worth having: the job asks
 * a registry which exporter produces `svg` and which produces `png`, and gets two objects
 * of one shape. Neither package is named anywhere in `@tyto/pipeline`.
 *
 * `rasterized: false`: an SVG document *is* the artifact. No browser is involved, which is
 * why `tyto render --types svg` never launches one.
 */

export interface SvgExporterPluginOptions {
  /** Bound now, not passed per frame — see `htmlExporterPlugin` for why. */
  readonly resources?: SvgResources;
  /** Draw text as outlines. A caller can still ask per output request. */
  readonly textAsPaths?: boolean;
}

/**
 * This package's own `tyto-plugin.json`, exported so a caller can list the plugin without
 * activating it — `tyto plugin list` does exactly that. `unknown`, because the manifest is
 * a document to be validated and not a shape to be trusted (see `Plugin.manifest`).
 */
export const svgExporterManifest: unknown = manifest;

export function svgExporterPlugin(options: SvgExporterPluginOptions = {}): Plugin {
  const id = manifest.name;

  return {
    id,
    manifest,
    activate: (host) =>
      host.registerExporter({
        id,
        mime: 'image/svg+xml',
        extension: 'svg',
        kinds: ['svg'],
        rasterized: false,
        exportFrame: (scene, artwork, frame, frameOptions) => {
          // The request wins over the registration: a caller that asked for outlines on
          // this one output meant this one output.
          const textAsPaths = frameOptions?.textAsPaths ?? options.textAsPaths;
          return exportFrameSvg(scene, artwork, frame, {
            ...(options.resources === undefined ? {} : { resources: options.resources }),
            ...(textAsPaths === undefined ? {} : { textAsPaths }),
          });
        },
      }),
  };
}
