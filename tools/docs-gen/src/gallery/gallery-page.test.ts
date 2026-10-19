import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { LOCALES, type Locale } from '../reference/markdown.js';
import { renderGalleryPage } from './gallery-page.js';
import { BUILT_IN_PACK, type Pack, readPack } from './pack.js';

/** Where the page lives in the site: `pages/templates/` in English, under `pages/pt-BR/` else. */
const galleryPagePath = (locale: Locale): string =>
  fileURLToPath(
    new URL(
      `../../../../apps/docs/pages/${locale === 'en' ? '' : `${locale}/`}templates/gallery.md`,
      import.meta.url,
    ),
  );

let pack: Pack;

beforeAll(async () => {
  pack = await readPack();
});

/**
 * The same two halves as the Reference pages: `pnpm docs:gen` runs this with `--update` to
 * write the gallery, and every other run fails when a manifest or `formats.yaml` changed and
 * the page did not. The pictures are not part of it — they need Chromium and the brand fonts
 * (ADR 0102), so they are made by `pnpm docs:template-shots` and checked only for existing.
 */
describe.each(LOCALES)('the %s template gallery', (locale) => {
  it('matches what the built-in pack holds today', async () => {
    await expect(
      renderGalleryPage(pack, locale),
      'the template gallery is out of date — run `pnpm docs:gen` and commit the result.',
    ).toMatchFileSnapshot(galleryPagePath(locale));
  });
});

describe('what the gallery is made from', () => {
  it('lists every template folder of the pack, and every one loaded', () => {
    const folders = readdirSync(BUILT_IN_PACK, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(`${BUILT_IN_PACK}/${entry.name}/manifest.yaml`))
      .map((entry) => entry.name)
      .sort();

    expect(pack.failures).toEqual([]);
    expect(pack.templates.map((template) => template.manifest.name).sort()).toEqual(folders);
  });

  it('describes every template, so no section opens with a picture and nothing else', () => {
    for (const { manifest } of pack.templates) {
      expect(manifest.description, manifest.name).toBeDefined();
    }
  });
});
