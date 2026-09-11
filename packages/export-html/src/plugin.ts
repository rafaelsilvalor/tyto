import type { Plugin } from '@tyto/plugin-api';

import { exportFrameHtml } from './export-html.js';
import type { HtmlResources } from './html.js';

/**
 * This exporter, as the plugin it is (ADR 0007, `docs/plugin-api.md`).
 *
 * It lives here rather than in `apps/cli` so that a built-in ships with the thing it plugs
 * in, and so that the CLI, the desktop app and every test reach it through one factory
 * instead of three copies of the same six fields. Composition — which resources, which
 * host — stays with the caller, which is what ADR 0010 actually asks for.
 *
 * `rasterized: true`: this exporter's document is HTML, and HTML is not a file anybody
 * asked for. It becomes `png`, `jpeg` or `webp` through a `Rasterizer`, and saying so here
 * is what lets a job stop asking `kind === 'svg'`.
 */

export interface HtmlExporterPluginOptions {
  /**
   * Bound now, not passed per frame.
   *
   * An exporter's resources have a shape only that exporter knows — this one's `font` takes
   * an `HtmlFontFace` where the SVG exporter's takes an `SvgFontFace` — so closing over
   * them at registration keeps the extension point out of an argument that belongs to
   * TYTO-62.
   */
  readonly resources?: HtmlResources;
  /** Two spaces of indentation and one node per line. Off here: these bytes feed a browser. */
  readonly pretty?: boolean;
  /** Defaults to `html`. Only a second HTML exporter would ever need to change it. */
  readonly id?: string;
}

/** The raster kinds a Chromium rasterizer turns this exporter's document into. */
export const HTML_EXPORTER_KINDS: readonly string[] = ['png', 'jpeg', 'webp'];

export function htmlExporterPlugin(options: HtmlExporterPluginOptions = {}): Plugin {
  const id = options.id ?? 'html';

  return {
    id,
    activate: (host) =>
      host.registerExporter({
        id,
        mime: 'text/html',
        extension: 'html',
        kinds: HTML_EXPORTER_KINDS,
        rasterized: true,
        exportFrame: (scene, artwork, frame) =>
          exportFrameHtml(scene, artwork, frame, {
            ...(options.resources === undefined ? {} : { resources: options.resources }),
            ...(options.pretty === undefined ? {} : { pretty: options.pretty }),
          }),
      }),
  };
}
