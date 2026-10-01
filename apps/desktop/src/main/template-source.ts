import type { AssetRef, FileSystem, Size, TemplateRegistry } from '@tyto/core';
import {
  type ExportResources,
  type InstalledCodePack,
  fileTemplateAssets,
  installedTemplateSource,
} from '@tyto/io';
import {
  type LocalTemplateSource,
  type TemplateSource,
  bundledTemplateSource,
  markupTemplateSource,
} from '@tyto/pipeline';
import { BUILT_IN_TEMPLATE_BUILDS } from '@tyto/templates';

import { fonts } from './fonts.js';

/** A template source, and the bytes of whatever its markup drew from its own folder. */
export interface TemplateWiring {
  readonly source: TemplateSource;
  /**
   * The template's own `src=` files, for the exporters.
   *
   * Empty until `source` has loaded a markup template, and filled by that load: the folder
   * is only known once the brief has named the template, which happens inside the job. An
   * exporter only asks for bytes after the template stage has run, so the order holds — the
   * CLI's `templateWiring` relies on the same one.
   */
  readonly resources: ExportResources;
}

/**
 * Where the preview and the export get a template's function (ADR 0048).
 *
 * Built-in code in front of markup, as it always was, and an installed code template in
 * front of both — for a name the registry found in a pack whose plugin runs in a utility
 * process, and only that. The template's code runs there and nowhere else: this reaches it
 * through the proxy `connectIsolatedPlugin` registered, never through an import.
 *
 * A markup template is handed its own folder's files (TYTO-176), the way `tyto render` hands
 * them over in `apps/cli/src/render-context.ts`. Without them a `<vector src="assets/…">`
 * or an `<image src="assets/…">` failed to compile in the window and the template drew
 * nothing at all, while the CLI drew it whole.
 *
 * One function so that the preview and the export cannot draw one template two ways.
 */
export function templateSourceOf(
  fileSystem: FileSystem,
  registry: TemplateRegistry,
  codePacks: readonly InstalledCodePack[],
  /** The template folder's reader. A seam for the test that a folderless name reads nothing. */
  readTemplateAssets: typeof fileTemplateAssets = fileTemplateAssets,
): TemplateWiring {
  const loaded: ExportResources[] = [];

  const asset = (ref: AssetRef): string | undefined => {
    for (const resources of loaded) {
      const found = resources.html?.asset?.(ref);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const assetSize = (ref: AssetRef): Size | undefined => {
    for (const resources of loaded) {
      const found = resources.svg?.assetSize?.(ref);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const markup: LocalTemplateSource = {
    async load(name) {
      const directory = registry.directoryOf(name);
      // No folder to read — a name the registry does not know. Delegated so the
      // `E_UNKNOWN_TEMPLATE` an author reads is the one wording wherever it came from.
      if (directory === undefined) return markupTemplateSource(fileSystem, registry).load(name);

      const own = await readTemplateAssets({ base: directory });
      loaded.push(own.resources);
      return markupTemplateSource(fileSystem, registry, { assets: own.assets }).load(name);
    },
  };

  const builtIn = bundledTemplateSource({
    registry,
    fileSystem,
    bundled: BUILT_IN_TEMPLATE_BUILDS,
    markup,
  });
  const resources: ExportResources = { html: { asset }, svg: { asset, assetSize } };
  if (codePacks.length === 0) return { source: builtIn, resources };
  return {
    source: installedTemplateSource({
      registry,
      packs: codePacks,
      fonts: {
        outlines: (face) => fonts.source.outlines(face),
        fromMachine: (face) => fonts.fromMachine(face),
      },
      next: builtIn,
    }),
    resources,
  };
}

/**
 * The brief's files first and the template's second, the CLI's order (`render-task.ts`).
 *
 * The two rarely answer the same ref — a template's are keyed by its own folder's absolute
 * paths — but when both could, the brief is what the person chose for this artwork.
 */
export function briefThenTemplate(
  brief: ExportResources | undefined,
  template: ExportResources,
): ExportResources {
  const asset = (ref: AssetRef): string | undefined =>
    brief?.html?.asset?.(ref) ?? template.html?.asset?.(ref);
  const assetSize = (ref: AssetRef): Size | undefined =>
    brief?.svg?.assetSize?.(ref) ?? template.svg?.assetSize?.(ref);
  return { html: { asset }, svg: { asset, assetSize } };
}
