import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { diagnostic } from '@tyto/core';
import { NO_INSTALLED_PACKS, NO_PLUGIN_FILES, nodeFileSystem } from '@tyto/io';
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

  it('names each format by its label from formats.yaml, keeping the id beside it', async () => {
    // TYTO-196: the shipped pack's `formats.yaml` labels every format, so the dialog can say
    // "Grid 1:1" and still send `grid-1x1`.
    const catalogue = await createTemplateCatalogue({
      sources: await sourcesOver(packDirectory),
    });

    const formats = (await catalogue.list()).templates.flatMap((template) => template.formats);
    expect(formats).toContainEqual({ id: 'grid-1x1', label: 'Grid 1:1' });
    expect(formats).toContainEqual({ id: 'grid', label: 'Grid' });
    expect(formats).toContainEqual({ id: 'story', label: 'Story' });
  });

  it('falls back to the id for a format with no label, or with no catalogue at all', async () => {
    // `label` is optional in a third-party `formats.yaml`, and a folder with none has no
    // catalogue; either way the dialog shows what it showed before labels existed.
    const withoutCatalogue = await createTemplateCatalogue({
      sources: await sourcesOver(scratch),
    });
    const bare = (await withoutCatalogue.list()).templates.find(
      (item) => item.name === 'with-preview',
    );
    expect(bare?.formats).toEqual([{ id: 'feed', label: 'feed' }]);

    // Its own folder, so the broken-folder case below still sees exactly the two it built.
    const unlabelled = mkdtempSync(join(tmpdir(), 'tyto-unlabelled-'));
    mkdirSync(join(unlabelled, 'pack'), { recursive: true });
    writeFileSync(
      join(unlabelled, 'formats.yaml'),
      ['feed: { w: 1080, h: 1080, kind: grid }', 'wide: { w: 1920, h: 1080, label: Wide }'].join(
        '\n',
      ),
    );
    writeFileSync(
      join(unlabelled, 'pack', 'manifest.yaml'),
      ['name: pack', 'version: 1.0.0', 'formats: [feed, wide]', 'slots: {}'].join('\n'),
    );
    const withCatalogue = await createTemplateCatalogue({
      sources: await sourcesOver(unlabelled),
    });
    const pack = (await withCatalogue.list()).templates.find((item) => item.name === 'pack');
    expect(pack?.formats).toEqual([
      { id: 'feed', label: 'feed' },
      { id: 'wide', label: 'Wide' },
    ]);
    rmSync(unlabelled, { recursive: true, force: true });
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

  it("lists the plugin files' last sync among the failures, with no brief open (TYTO-433)", async () => {
    const sources = await sourcesOver(join(scratch, 'with-preview'));
    const fetch = diagnostic('W_PLUGIN_FILE_FETCH', {
      git: 'https://example.invalid/tabela.git',
      ref: 'v1',
      problem: 'fatal: repository not found',
      outcome: 'Nothing from it loads.',
    });
    await sources.setFetched({
      packs: NO_INSTALLED_PACKS,
      only: new Map(),
      replaces: new Set(),
      problems: [fetch],
      configured: NO_PLUGIN_FILES.configured,
      images: NO_PLUGIN_FILES.images,
      texts: NO_PLUGIN_FILES.texts,
    });

    const { failures } = await (await createTemplateCatalogue({ sources })).list();

    expect(failures).toEqual([
      {
        directory: 'plugin-files',
        diagnostics: [{ severity: 'warning', code: 'W_PLUGIN_FILE_FETCH', message: fetch.message }],
      },
    ]);
  });

  it('lists an alias as a row of its own, the template it reaches under its name (TYTO-433)', async () => {
    const sources = await sourcesOver(scratch);
    await sources.setFetched({
      packs: NO_INSTALLED_PACKS,
      only: new Map(),
      replaces: new Set(),
      problems: [],
      configured: {
        project: [],
        machine: [
          {
            template: 'with-preview',
            file: 'cores.yaml',
            directory: scratch,
            configurations: [{ name: 'escura', alias: 'with-preview-escura', values: {} }],
          },
        ],
      },
      images: NO_PLUGIN_FILES.images,
      texts: new Map(),
    });

    const { templates } = await (await createTemplateCatalogue({ sources })).list();

    const [template, alias] = templates;
    expect(templates.map((item) => item.name)).toEqual(['with-preview', 'with-preview-escura']);
    expect(alias).toEqual({
      ...template,
      name: 'with-preview-escura',
      alias: { template: 'with-preview', configuration: 'escura' },
      configured: { filled: [] },
    });
  });

  it('carries what the configuration a name reaches says about a new brief (TYTO-440)', async () => {
    const sources = await sourcesOver(scratch);
    const skeleton = '---\ntemplate: with-preview\n---\n';
    await sources.setFetched({
      packs: NO_INSTALLED_PACKS,
      only: new Map(),
      replaces: new Set(),
      problems: [],
      configured: {
        project: [],
        machine: [
          {
            template: 'with-preview',
            file: 'cores.yaml',
            directory: scratch,
            default: 'clara',
            configurations: [
              {
                name: 'clara',
                values: {},
                brief: { slots: { titulo: { value: 'Agenda' } }, skeleton: { value: skeleton } },
              },
              { name: 'escura', values: {}, brief: { formats: { value: ['feed'] } } },
            ],
          },
        ],
      },
      images: NO_PLUGIN_FILES.images,
      texts: new Map(),
    });

    const { templates } = await (await createTemplateCatalogue({ sources })).list();
    const configured = Object.fromEntries(templates.map((row) => [row.name, row.configured]));

    // The bare name reaches the `default`; a named configuration starts from it.
    expect(configured['with-preview']).toEqual({ skeleton, filled: ['titulo'] });
    expect(configured['with-preview-escura']).toEqual({
      skeleton,
      formats: ['feed'],
      filled: ['titulo'],
    });
  });

  it('carries each manifest’s slots and names the folder a template came from', async () => {
    // TYTO-275: the skeleton is built from the slots in the window, and the picker says whose
    // template it is — `null` is the built-in pack, which the window names in its language.
    const catalogue = await createTemplateCatalogue({
      sources: await sourcesOver(packDirectory, scratch),
    });

    const { templates } = await catalogue.list();
    const chosen = templates.find((item) => item.name === 'with-preview');
    const agenda = templates.find((item) => item.name === 'agenda-semana');

    expect(chosen?.root).toBe(basename(scratch));
    expect(chosen?.slots).toEqual({
      titulo: { type: 'rich-text', required: false, repeat: false },
    });
    expect(agenda?.root).toBeNull();
    expect(agenda?.slots['lamina']).toMatchObject({ repeat: true, min: 1 });
  });

  it('answers an empty list for a folder that is not there', async () => {
    // The desktop should open and say it has no templates, not refuse to start.
    const catalogue = await createTemplateCatalogue({
      sources: await sourcesOver(join(scratch, 'nowhere')),
    });

    expect((await catalogue.list()).templates).toEqual([]);
  });
});
