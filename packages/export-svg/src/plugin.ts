import type { Plugin } from '@tyto/plugin-api';

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
  readonly id?: string;
}

export function svgExporterPlugin(options: SvgExporterPluginOptions = {}): Plugin {
  const id = options.id ?? 'svg';

  return {
    id,
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
