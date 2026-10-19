import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type FormatCatalogue,
  type TemplateManifest,
  loadFormats,
  loadTemplateRegistry,
} from '@tyto/core';
import { nodeFileSystem } from '@tyto/io';

/**
 * The built-in pack as the gallery reads it: the folder `apps/cli` and the window load, read
 * through the same `loadTemplateRegistry` and `loadFormats`, so the page lists what the app
 * offers and not a copy of it.
 */
export const BUILT_IN_PACK = fileURLToPath(
  new URL('../../../../packages/templates/templates', import.meta.url),
);

export const BUILT_IN_FORMATS_FILE = join(BUILT_IN_PACK, 'formats.yaml');

/** Where the gallery's pictures live in the site: `pages/public/template-gallery/` (ADR 0102). */
export const GALLERY_IMAGES = fileURLToPath(
  new URL('../../../../apps/docs/pages/public/template-gallery', import.meta.url),
);

/** The site path a page names one template's picture by. */
export const galleryImagePath = (name: string): string => `/template-gallery/${name}.png`;

export interface GalleryTemplate {
  readonly manifest: TemplateManifest;
  /** The example brief the picture is rendered from, relative to the template's folder. */
  readonly example: string;
  /** The format the picture is in: the manifest's first, which is the one it leads with. */
  readonly pictureFormat: string;
}

export interface Pack {
  readonly templates: readonly GalleryTemplate[];
  readonly formats: FormatCatalogue;
  /** One line per folder whose manifest did not load, which the freshness test refuses. */
  readonly failures: readonly string[];
}

/**
 * A template's picture comes from the first `.brief` in its `examples/` folder, by name. The
 * examples are the fixtures the contract test already holds to "renders with no overflow", so
 * the picture is of a brief known to fit — and naming the rule here keeps the page and the
 * shots script from choosing differently.
 */
async function firstExample(directory: string): Promise<string | undefined> {
  const names = await readdir(join(directory, 'examples')).catch(() => []);
  const brief = names.filter((name) => name.endsWith('.brief')).sort()[0];
  return brief === undefined ? undefined : `examples/${brief}`;
}

export async function readPack(): Promise<Pack> {
  const fileSystem = nodeFileSystem();
  const formats = await loadFormats(fileSystem, BUILT_IN_FORMATS_FILE);
  if (!formats.ok) throw new Error(formats.error.map((item) => item.message).join('; '));

  const registry = await loadTemplateRegistry(fileSystem, BUILT_IN_PACK);
  if (!registry.ok) throw new Error(registry.error.map((item) => item.message).join('; '));

  const templates: GalleryTemplate[] = [];
  const failures = registry.value.failures.map((failure) =>
    failure.diagnostics.map((item) => item.message).join('; '),
  );
  for (const manifest of registry.value.list()) {
    const directory = registry.value.directoryOf(manifest.name) ?? '';
    const example = await firstExample(directory);
    const pictureFormat = manifest.formats[0];
    if (example === undefined || pictureFormat === undefined) {
      failures.push(`${manifest.name} has no example brief to draw its picture from`);
      continue;
    }
    templates.push({ manifest, example, pictureFormat });
  }

  return { templates, formats: formats.value, failures };
}
