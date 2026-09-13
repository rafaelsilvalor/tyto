import { htmlExporterManifest, htmlExporterPlugin } from '@tyto/export-html';
import { svgExporterManifest, svgExporterPlugin } from '@tyto/export-svg';
import type { ExportResources } from '@tyto/io';
import { type InProcessHost, type Plugin, createPluginHost } from '@tyto/plugin-api';
import type { Rasterizer } from '@tyto/raster';

import builtInTemplatesManifest from './built-in-templates.tyto-plugin.json';
import chromiumManifest from './chromium.tyto-plugin.json';
import fsInboxManifest from './fs-inbox.tyto-plugin.json';
import fsOutboxManifest from './fs-outbox.tyto-plugin.json';
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

/**
 * Every built-in's `tyto-plugin.json`, as shipped — what `tyto plugin list` reads.
 *
 * A catalog rather than a walk over an activated host, because listing is not activating.
 * `activateBuiltIns` wires one render: it leaves the rasterizer out when there is nothing
 * to raster, and it never wires the queue at all, so a listing built from it would be
 * shorter on some runs than on others. `code --list-extensions` reads manifests off a disk
 * for the same reason, and listing would otherwise have to launch a browser to tell you a
 * browser is installed.
 *
 * `unknown`, so the command validates these with the same schema a loaded plugin's file
 * goes through. `plugins.test.ts` asserts each entry is the very object its factory ships,
 * which is what keeps this list from drifting out of step with the plugins themselves.
 */
export const BUILT_IN_MANIFESTS: readonly unknown[] = [
  htmlExporterManifest,
  svgExporterManifest,
  builtInTemplatesManifest,
  chromiumManifest,
  fsInboxManifest,
  fsOutboxManifest,
];

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

  // `host.activate`, not `plugin.activate(host.hostFor(...))`. The host is what validates
  // the `tyto-plugin.json` each of these ships, checks that its `contributes` matches what
  // the plugin actually registered, and records the plugin so `tyto plugin list` has
  // something to print. Calling `hostFor` straight would skip all three — a shortcut
  // available to a built-in and to nobody else, which is the shape ADR 0007 rules out.
  for (const plugin of plugins) host.activate(plugin);

  return host;
}

export { type CloseableRasterizer, defaultRasterizer, rasterizerPlugin } from './rasterizer.js';
export { type TemplatePackOptions, templatePackPlugin } from './templates.js';
export { sinkPlugin, sourcePlugin } from './queue.js';
