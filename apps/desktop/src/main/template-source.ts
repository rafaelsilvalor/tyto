import type { FileSystem, TemplateRegistry } from '@tyto/core';
import { type InstalledCodePack, installedTemplateSource } from '@tyto/io';
import { type TemplateSource, bundledTemplateSource, markupTemplateSource } from '@tyto/pipeline';
import { BUILT_IN_TEMPLATE_BUILDS } from '@tyto/templates';

import { fonts } from './fonts.js';

/**
 * Where the preview and the export get a template's function (ADR 0048).
 *
 * Built-in code in front of markup, as it always was, and an installed code template in
 * front of both — for a name the registry found in a pack whose plugin runs in a utility
 * process, and only that. The template's code runs there and nowhere else: this reaches it
 * through the proxy `connectIsolatedPlugin` registered, never through an import.
 *
 * One function so that the preview and the export cannot draw one template two ways.
 */
export function templateSourceOf(
  fileSystem: FileSystem,
  registry: TemplateRegistry,
  codePacks: readonly InstalledCodePack[],
): TemplateSource {
  const builtIn = bundledTemplateSource({
    registry,
    fileSystem,
    bundled: BUILT_IN_TEMPLATE_BUILDS,
    markup: markupTemplateSource(fileSystem, registry),
  });
  if (codePacks.length === 0) return builtIn;
  return installedTemplateSource({
    registry,
    packs: codePacks,
    fonts: {
      outlines: (face) => fonts.source.outlines(face),
      fromMachine: (face) => fonts.fromMachine(face),
    },
    next: builtIn,
  });
}
