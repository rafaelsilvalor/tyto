import type { Plugin } from '@tyto/plugin-api';

/** The manifest, imported rather than declared: see `svgExporterPlugin` for why. */
import manifest from '../tyto-plugin.json';

import { type PsdResources, exportFramePsd } from './export-psd.js';

export interface PsdExporterPluginOptions {
  /** Bound now, not passed per frame (ADR 0221): the host decodes each layer's PNG. */
  readonly resources?: PsdResources;
}

/** This package's own `tyto-plugin.json`, for a caller that lists without activating. */
export const psdExporterManifest: unknown = manifest;

/**
 * This exporter, as the plugin it is (ADR 0007, ADR 0221).
 *
 * `rasterized: false`: the answer is the file's bytes, a `Uint8Array`, which the job hands to
 * the sink as it came. It writes only a frame with a `guide` whose painted layers carry their
 * `raster`, which is what `JobRequest.guide` asks the pipeline for.
 */
export function psdExporterPlugin(options: PsdExporterPluginOptions = {}): Plugin {
  const id = manifest.name;

  return {
    id,
    manifest,
    activate: (host) =>
      host.registerExporter({
        id,
        mime: 'image/vnd.adobe.photoshop',
        extension: 'psd',
        kinds: ['psd'],
        rasterized: false,
        exportFrame: (scene, artwork, frame) =>
          exportFramePsd(scene, artwork, frame, {
            ...(options.resources === undefined ? {} : { resources: options.resources }),
          }),
      }),
  };
}
