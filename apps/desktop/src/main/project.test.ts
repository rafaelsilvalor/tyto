import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { diagnostic } from '@tyto/core';
import { NO_INSTALLED_PACKS, NO_PLUGIN_FILES, nodeFileSystem } from '@tyto/io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type ProjectSnapshot, createProjectSources } from './project.js';

/**
 * Which folders are searched, and in which order (TYTO-122).
 *
 * Driven against real folders built here rather than against a fake filesystem, for the
 * reason `templates.test.ts` already gives: the claim is about precedence between two roots,
 * and precedence is `loadTemplateRegistry`'s. A fake would assert the fake.
 *
 * Two packs are written: a stand-in for the built-in one holding `promo-curso` and `aviso`,
 * and a "user" one holding its own `promo-curso` plus a `campanha` that exists nowhere else.
 * That is exactly the shape the card's first criterion describes — the user's `promo-curso`
 * shadows the built-in one, matching what the CLI already does (ADR 0020).
 */

const manifest = (name: string, description: string): string =>
  [
    `name: ${name}`,
    'version: 1.0.0',
    `description: ${description}`,
    'formats: [feed]',
    'slots:',
    '  titulo: { type: rich-text, required: true }',
  ].join('\n');

const pack = (root: string, templates: readonly (readonly [string, string])[]): void => {
  for (const [name, description] of templates) {
    const directory = join(root, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'manifest.yaml'), manifest(name, description), 'utf8');
  }
};

let scratch: string;
let builtIn: string;
let mine: string;
let empty: string;

const sourcesOver = (folder?: string) =>
  createProjectSources({
    fileSystem: nodeFileSystem(),
    builtIn,
    ...(folder === undefined ? {} : { folder }),
  });

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-project-'));

  builtIn = join(scratch, 'built-in');
  pack(builtIn, [
    ['promo-curso', 'the built-in one'],
    ['aviso', 'only in the pack'],
  ]);
  // The formats the built-in pack declares, which is what the app falls back to. The shape is
  // the real one — a top-level map of name to size, as `packages/templates/formats.yaml` has
  // it — because a fixture in a shape the loader does not read proves nothing about the loader.
  writeFileSync(join(builtIn, 'formats.yaml'), 'feed: { w: 1080, h: 1080 }\n', 'utf8');

  mine = join(scratch, 'mine');
  pack(mine, [
    ['promo-curso', 'mine, and it wins'],
    ['campanha', 'only in my folder'],
  ]);

  empty = join(scratch, 'empty');
  mkdirSync(empty, { recursive: true });
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('the folders this app searches', () => {
  it('reads the built-in pack alone when no folder was chosen', async () => {
    const sources = await sourcesOver();
    const snapshot = sources.current();

    expect(snapshot.roots).toEqual([builtIn]);
    expect(
      snapshot.registry
        ?.list()
        .map((item) => item.name)
        .sort(),
    ).toEqual(['aviso', 'promo-curso']);
    expect(snapshot.folder).toBeUndefined();
  });

  it('searches the chosen folder first, so its template shadows the built-in one', async () => {
    const sources = await sourcesOver(mine);
    const snapshot = sources.current();

    // The card's first criterion, and the one thing that would be silently wrong if the roots
    // were passed in the other order: the answer would still have two templates with the right
    // names and the *wrong* files behind them.
    expect(snapshot.roots).toEqual([mine, builtIn]);
    expect(snapshot.registry?.get('promo-curso')?.description).toBe('mine, and it wins');
    expect(snapshot.registry?.directoryOf('promo-curso')).toBe(join(mine, 'promo-curso'));
  });

  it('keeps the built-in templates the chosen folder does not replace', async () => {
    const sources = await sourcesOver(mine);

    // A chosen folder adds and overrides; it does not take over. `aviso` is only in the pack
    // and has to survive, or "point at a folder" would mean "lose everything else".
    expect(
      sources
        .current()
        .registry?.list()
        .map((item) => item.name)
        .sort(),
    ).toEqual(['aviso', 'campanha', 'promo-curso']);
  });

  it('says how many templates the chosen folder brought', async () => {
    const sources = await sourcesOver(mine);

    // Counted from the folder read **on its own**. Merged, this number cannot be recovered:
    // three templates from two roots says nothing about which root gave what.
    expect(sources.current().folder).toEqual({ path: mine, found: 2 });
  });

  it('reports a folder with no templates as zero, and keeps the built-in pack', async () => {
    const sources = await sourcesOver(empty);
    const snapshot = sources.current();

    // The card's fourth criterion. `found: 0` is what the window turns into a row in the
    // problems panel; the built-in templates are still all there, which is the half that
    // would have been easy to ship broken.
    expect(snapshot.folder).toEqual({ path: empty, found: 0 });
    expect(
      snapshot.registry
        ?.list()
        .map((item) => item.name)
        .sort(),
    ).toEqual(['aviso', 'promo-curso']);
  });

  it('reports an unreadable folder without taking the built-in pack down with it', async () => {
    const sources = await sourcesOver(join(scratch, 'not-there'));
    const snapshot = sources.current();

    expect(snapshot.diagnostics.some((item) => item.code === 'E_TEMPLATE_READ')).toBe(true);
    // Still a working app. A folder somebody deleted between two launches must not be the
    // thing that empties the picker.
    expect(snapshot.registry?.list().length).toBe(2);
  });

  it('goes back to the built-in pack when the folder is cleared, with no restart', async () => {
    const sources = await sourcesOver(mine);
    expect(sources.current().registry?.get('campanha')).toBeDefined();

    await sources.reload(undefined);

    // The card's fifth criterion. The same object answers differently, which is the whole
    // reason it is a holder rather than three services rebuilt.
    expect(sources.current().roots).toEqual([builtIn]);
    expect(sources.current().registry?.get('campanha')).toBeUndefined();
    expect(sources.current().folder).toBeUndefined();
  });

  it('hands out a new snapshot object per reload, which is what the picker caches on', async () => {
    const sources = await sourcesOver();
    const before = sources.current();

    await sources.reload(mine);

    // `templates.ts` memoises on this identity. If a reload mutated the snapshot in place
    // instead, the picker would keep answering with the old list for the life of the window.
    expect(sources.current()).not.toBe(before);
  });

  it('falls back to the built-in formats when the chosen folder has none', async () => {
    const sources = await sourcesOver(mine);

    // The decision the card raised in one sentence and did not settle. `loadFormats` errs on a
    // file that is not there, and a service with no catalogue renders **zero frames for every
    // brief** — so an unconditional `<chosen>/formats.yaml` would mean that picking any
    // ordinary folder breaks the app. Absent is silent.
    expect(sources.current().formats).toBeDefined();
    expect(sources.current().diagnostics.some((item) => item.code === 'E_FORMATS_READ')).toBe(
      false,
    );
  });

  it("uses the chosen folder's formats.yaml when it has one", async () => {
    const withFormats = join(scratch, 'with-formats');
    pack(withFormats, [['quadrado', 'mine']]);
    writeFileSync(join(withFormats, 'formats.yaml'), 'vitrine: { w: 1200, h: 628 }\n', 'utf8');

    const sources = await sourcesOver(withFormats);

    // Replaces rather than merges, because `--formats-file` replaces in the CLI and two
    // semantics for one file is how two people end up disagreeing about what a format is.
    expect(sources.current().formats?.has('vitrine')).toBe(true);
    expect(sources.current().formats?.has('feed')).toBe(false);
  });

  it('keeps rendering when the chosen formats.yaml is broken, and says so', async () => {
    const broken = join(scratch, 'broken-formats');
    pack(broken, [['algo', 'mine']]);
    writeFileSync(join(broken, 'formats.yaml'), 'vitrine: { w: "not a number" }\n', 'utf8');

    const sources = await sourcesOver(broken);
    const snapshot = sources.current();

    // A file the person wrote and got wrong is worth a line. A file they never wrote is not —
    // which is the case above. Both keep the app rendering.
    expect(snapshot.formats).toBeDefined();
    expect(snapshot.diagnostics.some((item) => item.code.startsWith('E_FORMATS'))).toBe(true);
  });
});

describe("installed plugins' packs (ADR 0046)", () => {
  let installed: string;

  beforeAll(() => {
    installed = join(scratch, 'installed');
    pack(installed, [
      ['promo-curso', 'an installed one, hidden'],
      ['cartaz', 'only in the installed pack'],
    ]);
  });

  const skipped = diagnostic('W_PLUGIN_SKIPPED', { plugin: 'fora', reason: 'its pack leads out.' });

  it('searches them after the built-in pack, which keeps the names it has', async () => {
    const sources = await sourcesOver(mine);

    const snapshot = await sources.setInstalled({ directories: [installed], warnings: [] });

    // The CLI's order: the chosen folder, the built-in pack, then installed packs.
    expect(snapshot.roots).toEqual([mine, builtIn, installed]);
    expect(snapshot.registry?.get('cartaz')?.description).toBe('only in the installed pack');
    expect(snapshot.registry?.get('promo-curso')?.description).toBe('mine, and it wins');
    expect(
      snapshot.diagnostics
        .filter((item) => item.code === 'W_TEMPLATE_SHADOWED')
        .map((item) => item.message)
        .some((message) => message.includes(join(installed, 'promo-curso'))),
    ).toBe(true);
  });

  it('keeps them, and the refusals, across a change of the chosen folder', async () => {
    const sources = await sourcesOver(mine);
    await sources.setInstalled({ directories: [installed], warnings: [skipped] });

    const snapshot = await sources.reload(undefined);

    expect(snapshot.roots).toEqual([builtIn, installed]);
    expect(snapshot.diagnostics).toContainEqual(skipped);
  });

  it('keeps the chosen folder when they arrive after it', async () => {
    const sources = await sourcesOver(mine);
    await sources.reload(empty);

    const snapshot = await sources.setInstalled({ directories: [installed], warnings: [] });

    expect(snapshot.roots).toEqual([empty, builtIn, installed]);
    expect(snapshot.folder).toEqual({ path: empty, found: 0 });
  });
});

describe("an open workspace's template folders (TYTO-278, ADR 0113)", () => {
  it('are searched after the chosen folder and before the built-in pack, until it closes', async () => {
    const sources = await sourcesOver(mine);

    const opened = await sources.setWorkspaceFolders([empty]);
    expect(opened.roots).toEqual([mine, empty, builtIn]);
    // The chosen folder keeps its place when the folders are read again.
    expect((await sources.reload(mine)).roots).toEqual([mine, empty, builtIn]);
    expect((await sources.setWorkspaceFolders([])).roots).toEqual([mine, builtIn]);
  });
});

describe('the packs the plugin files fetched (TYTO-433, ADR 0151 decision 7)', () => {
  let projectFiles: string;
  let machineFiles: string;
  let installed: string;

  beforeAll(() => {
    projectFiles = join(scratch, 'fetched-project');
    pack(projectFiles, [
      ['tabela', "the project file's"],
      ['aviso', 'a fetched one, hidden by the built-in pack'],
      ['rascunho', 'in the pack, but no file names it'],
    ]);
    machineFiles = join(scratch, 'fetched-machine');
    pack(machineFiles, [
      ['tabela', "the machine file's, hidden"],
      ['cartaz', "the machine file's"],
    ]);
    installed = join(scratch, 'installed-under-files');
    pack(installed, [
      ['cartaz', 'an installed one, hidden'],
      ['selo', 'installed by a plugin a file replaces'],
    ]);
  });

  const fetched = (replaces: readonly string[] = []) => ({
    packs: {
      directories: [projectFiles, machineFiles],
      owners: new Map([
        [projectFiles, 'project-pack'],
        [machineFiles, 'machine-pack'],
      ]),
      code: [],
      warnings: [],
      refused: new Set<string>(),
    },
    only: new Map([[projectFiles, new Set(['tabela', 'aviso'])]]),
    replaces: new Set(replaces),
    problems: [diagnostic('W_PLUGIN_SKIPPED', { plugin: 'fora', reason: 'it could not start.' })],
    configured: NO_PLUGIN_FILES.configured,
    images: NO_PLUGIN_FILES.images,
    texts: NO_PLUGIN_FILES.texts,
  });

  it('searches them after the built-in pack and before installed plugins, earlier winning', async () => {
    const sources = await sourcesOver();
    await sources.setInstalled({
      directories: [installed],
      warnings: [],
      owners: new Map([[installed, 'installed-pack']]),
    });

    const snapshot = await sources.setFetched(fetched());

    // Window's folder, workspace folders, built-in pack, project files, machine files, installed.
    expect(snapshot.roots).toEqual([builtIn, projectFiles, machineFiles, installed]);
    expect(snapshot.registry?.get('aviso')?.description).toBe('only in the pack');
    expect(snapshot.registry?.get('tabela')?.description).toBe("the project file's");
    expect(snapshot.registry?.get('cartaz')?.description).toBe("the machine file's");
    expect(snapshot.registry?.get('selo')?.description).toBe(
      'installed by a plugin a file replaces',
    );
    // A fetched pack offers what its file names, and nothing else.
    expect(snapshot.registry?.get('rascunho')).toBeUndefined();
    expect(snapshot.pluginFiles.map((item) => item.code)).toEqual(['W_PLUGIN_SKIPPED']);
  });

  it('leaves out the installed pack of a plugin a file replaces', async () => {
    const sources = await sourcesOver();
    await sources.setInstalled({
      directories: [installed],
      warnings: [],
      owners: new Map([[installed, 'installed-pack']]),
    });

    const snapshot = await sources.setFetched(fetched(['installed-pack']));

    expect(snapshot.roots).toEqual([builtIn, projectFiles, machineFiles]);
    expect(snapshot.registry?.get('selo')).toBeUndefined();
  });
});

describe("the plugin files' configurations and aliases (TYTO-433, ADR 0151)", () => {
  const entry = (template: string, name: string, alias: string) => ({
    template,
    file: 'cores.yaml',
    directory: scratch,
    configurations: [{ name, alias, values: {} }],
  });

  it('selects the template an alias names, and refuses one named like a template', async () => {
    const sources = await sourcesOver();

    const snapshot = await sources.setFetched({
      packs: NO_INSTALLED_PACKS,
      only: new Map(),
      replaces: new Set(),
      problems: [],
      configured: {
        project: [],
        machine: [
          entry('promo-curso', 'verde', 'promo-verde'),
          entry('aviso', 'roxo', 'promo-curso'),
        ],
      },
      images: NO_PLUGIN_FILES.images,
      texts: new Map([['cores.yaml', 'version: 1\n']]),
    });

    expect(snapshot.configurations.select('promo-verde')).toMatchObject({
      template: 'promo-curso',
      configuration: 'verde',
    });
    // `promo-curso` is a template that loaded, so no alias may take its name.
    expect(snapshot.configurations.aliases().map((alias) => alias.alias)).toEqual(['promo-verde']);
    const taken = snapshot.pluginFiles.find((item) => item.code === 'E_TEMPLATE_ALIAS_TAKEN');
    expect(taken?.message).toMatch(/^cores\.yaml(:\d+:\d+)?: /u);
    expect(taken?.range).toBeUndefined();
  });

  it('has none before a sync, and keeps them across a change of the chosen folder', async () => {
    const sources = await sourcesOver();
    expect(sources.current().configurations.aliases()).toEqual([]);

    await sources.setFetched({
      packs: NO_INSTALLED_PACKS,
      only: new Map(),
      replaces: new Set(),
      problems: [],
      configured: { project: [], machine: [entry('aviso', 'claro', 'aviso-claro')] },
      images: NO_PLUGIN_FILES.images,
      texts: new Map(),
    });
    const snapshot = await sources.reload(mine);

    expect(snapshot.configurations.select('aviso-claro')?.template).toBe('aviso');
  });
});

describe("a configuration's brand with no kit (TYTO-471, ADR 0155)", () => {
  // The brand on the file's fourth line, so the row's line is the `brand:` key's and not the
  // configuration's or the file's first.
  const text = [
    'version: 1',
    'aviso:',
    '  roxo:',
    '    brand: nonexistent',
    '  verde:',
    '    brand: casa',
    '',
  ].join('\n');
  const brandAt = (value: string) => {
    const start = text.indexOf(`brand: ${value}`) + 'brand: '.length;
    return { value, range: { start, end: start + value.length } };
  };
  const synced = () => ({
    packs: NO_INSTALLED_PACKS,
    only: new Map(),
    replaces: new Set<string>(),
    problems: [],
    configured: {
      project: [],
      machine: [
        {
          template: 'aviso',
          file: 'marcas.yaml',
          directory: scratch,
          configurations: [
            { name: 'roxo', values: {}, brand: brandAt('nonexistent') },
            { name: 'verde', values: {}, brand: brandAt('casa') },
          ],
        },
      ],
    },
    images: NO_PLUGIN_FILES.images,
    texts: new Map([['marcas.yaml', text]]),
  });
  const missing = (snapshot: ProjectSnapshot) =>
    snapshot.pluginFiles.filter((item) => item.code === 'W_BRAND_KIT_MISSING');

  it('says nothing before the plugins have said which kits there are', async () => {
    const sources = await sourcesOver();

    expect(missing(await sources.setFetched(synced()))).toEqual([]);
  });

  it('is a row at the `brand:` line of its plugin file once the kits are known', async () => {
    const sources = await sourcesOver();
    await sources.setFetched(synced());

    const rows = missing(await sources.setKitBrands(new Set(['casa'])));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.severity).toBe('warning');
    expect(rows[0]?.message).toMatch(/^marcas\.yaml:4:12: .*nonexistent/u);
  });

  it('is said again by the next sync, and not once a kit offers the brand', async () => {
    const sources = await sourcesOver();
    await sources.setKitBrands(new Set(['casa']));

    expect(missing(await sources.setFetched(synced()))).toHaveLength(1);
    expect(missing(await sources.setKitBrands(new Set(['casa', 'nonexistent'])))).toEqual([]);
  });
});
