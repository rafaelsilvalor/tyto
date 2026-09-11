import { htmlExporterPlugin } from '@tyto/export-html';
import { svgExporterPlugin } from '@tyto/export-svg';
import type { ExportResources } from '@tyto/io';
import { type InProcessHost, type Plugin, createPluginHost } from '@tyto/plugin-api';
import type { Rasterizer } from '@tyto/raster';

import { rasterizerPlugin } from './rasterizer.js';
import { templatePackPlugin } from './templates.js';

/**
 * Every built-in, through the host, in one place (ADR 0007, `docs/plugin-api.md` Phase 1).
 *
 * *Routes every built-in through it … the API is validated by real use before it opens.*
 * That sentence is the whole reason this file exists: a plugin API whose first real user is
 * a stranger is a plugin API nobody has tried. So the two exporters, the rasterizer and the
 * template pack are activated here exactly the way a third party's would be, and what the
 * rest of the app reads is the registry — never the packages.
 *
 * Built per render rather than once per process, because an exporter binds the bytes of the
 * folder it is rendering: two tasks in a `tyto watch` have different `assets/`, and an
 * exporter bound to the wrong one would embed the wrong logo. A host is two maps; building
 * one costs nothing worth caching.
 */

export interface BuiltInOptions {
  /** Bound into the exporters. Each gets the half it understands. */
  readonly resources?: ExportResources;
  /** Registered when the run has something to raster. Absent for an svg-only render. */
  readonly rasterizer?: Rasterizer;
}

export function activateBuiltIns(options: BuiltInOptions = {}): InProcessHost {
  const host = createPluginHost();

  const plugins: Plugin[] = [
    htmlExporterPlugin({
      ...(options.resources?.html === undefined ? {} : { resources: options.resources.html }),
      // The bytes feed a browser, not a reader. Indentation would be whitespace that
      // changes the hash of a render for nothing.
      pretty: false,
    }),
    svgExporterPlugin({
      ...(options.resources?.svg === undefined ? {} : { resources: options.resources.svg }),
    }),
    // Empty today: `@tyto/templates` is a stub and E4 has shipped no built-in pack. The
    // registration exists so the extension point is exercised rather than assumed.
    templatePackPlugin(),
    ...(options.rasterizer === undefined ? [] : [rasterizerPlugin(options.rasterizer)]),
  ];

  for (const plugin of plugins) plugin.activate(host.hostFor(plugin.id));

  return host;
}

export { type CloseableRasterizer, defaultRasterizer, rasterizerPlugin } from './rasterizer.js';
export { type TemplatePackOptions, templatePackPlugin } from './templates.js';
export { sinkPlugin, sourcePlugin } from './queue.js';
