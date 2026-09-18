import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { nodeFileSystem } from '@tyto/io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createProjectSources } from './project.js';
import { createTemplateCatalogue } from './templates.js';

/**
 * The picker's list, against the pack the app actually ships plus one folder built here.
 *
 * The same call `preview.test.ts` makes about using the real pack: what this file wires is
 * a registry to a channel, and wiring is only wrong against the real thing. The temporary
 * folder is for the two cases the shipped pack cannot show — a `preview.png` and a manifest
 * that does not parse — and both are cases the picker has to survive rather than features.
 */

const require_ = createRequire(import.meta.url);
const packDirectory = join(dirname(require_.resolve('@tyto/templates/package.json')), 'templates');

/** A one-pixel PNG, so the `data:` URI is checked against bytes that really are a PNG. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * A `ProjectSources` over real folders, which is what these suites want.
 *
 * `createProjectSources` is the production object and not a fake: what is being asserted is
 * that a registry reaches a service, and a fake holder would assert the fake.
 */
const sourcesOver = async (builtIn: string, folder?: string) =>
  createProjectSources({
    fileSystem: nodeFileSystem(),
    builtIn,
    ...(folder === undefined ? {} : { folder }),
  });

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-templates-'));

  const good = join(scratch, 'with-preview');
  mkdirSync(good, { recursive: true });
  writeFileSync(
    join(good, 'manifest.yaml'),
    [
      'name: with-preview',
      'version: 1.0.0',
      'description: Has a picture',
      'formats: [feed]',
      'slots:',
      '  titulo:',
      '    type: rich-text',
    ].join('\n'),
  );
  writeFileSync(join(good, 'preview.png'), Buffer.from(PIXEL, 'base64'));

  const broken = join(scratch, 'broken');
  mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, 'manifest.yaml'), 'name: 1\nthis is: not a manifest\n');
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('the template catalogue', () => {
  it('lists the shipped pack with what a picker needs to show it', async () => {
    const catalogue = await createTemplateCatalogue({
      sources: await sourcesOver(packDirectory),
    });

    const { templates } = await catalogue.list();
    expect(templates.length).toBeGreaterThan(0);

    for (const template of templates) {
      expect(template.name).not.toBe('');
      expect(template.version).toMatch(/^\d+\.\d+\.\d+$/u);
      // A template renders at least one format; the picker shows them before you choose.
      expect(template.formats.length).toBeGreaterThan(0);
    }
  });

  it('carries a preview.png across as bytes, not as a path', async () => {
    // A path would be refused by the renderer's `img-src 'self' data:` policy, which is the
    // whole of the reason since ADR 0024 retired the other one — that the renderer would
    // later run in a browser tab with no disk under it. It will not.
    const catalogue = await createTemplateCatalogue({
      sources: await sourcesOver(scratch),
    });

    const found = (await catalogue.list()).templates.find((item) => item.name === 'with-preview');
    expect(found?.description).toBe('Has a picture');
    expect(found?.preview).toBe(`data:image/png;base64,${PIXEL}`);
  });

  it('leaves the preview off a template that has none, rather than failing', async () => {
    // Which is every built-in today. A missing picture must not cost the entry.
    const catalogue = await createTemplateCatalogue({
      sources: await sourcesOver(packDirectory),
    });

    for (const template of (await catalogue.list()).templates) {
      expect(template.preview).toBeUndefined();
    }
  });

  it('keeps the working templates when one folder is broken, and names the broken one', async () => {
    // The registry keeps the two apart on purpose. A picker emptied by one bad manifest
    // would be a third party breaking the app by shipping a typo.
    const catalogue = await createTemplateCatalogue({
      sources: await sourcesOver(scratch),
    });

    const answer = await catalogue.list();
    expect(answer.templates.map((item) => item.name)).toEqual(['with-preview']);
    expect(answer.failures).toHaveLength(1);
    expect(answer.failures[0]?.directory).toContain('broken');
    // The registry's own diagnostics, carried across rather than summarised: the code is
    // what `docs/diagnostic-codes.md` is indexed by, and the panel draws it as a row.
    expect(answer.failures[0]?.diagnostics.length).toBeGreaterThan(0);
    expect(answer.failures[0]?.diagnostics[0]?.code).toMatch(/^E_/u);
    expect(answer.failures[0]?.diagnostics[0]?.message).not.toBe('');
  });

  it('answers an empty list for a folder that is not there', async () => {
    // The desktop should open and say it has no templates, not refuse to start.
    const catalogue = await createTemplateCatalogue({
      sources: await sourcesOver(join(scratch, 'nowhere')),
    });

    expect((await catalogue.list()).templates).toEqual([]);
  });
});
