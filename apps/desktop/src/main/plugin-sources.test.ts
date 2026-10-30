import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import { type Plugin, PLUGIN_API_VERSION, type LoadedPlugins } from '@tyto/plugin-api';
import { err, ok, diagnostic } from '@tyto/core';
import { nodeFileSystem } from '@tyto/io';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createExportService } from './export.js';
import { fontsFor } from './fonts.js';
import { ASK_AGAIN, type DesktopSources, NOT_FETCHED, desktopSources } from './plugin-sources.js';
import { createPreviewService } from './preview.js';
import { createProjectSources } from './project.js';
import { windowPlugins } from './window-plugins.js';
import type { SourceTrust } from './workspace.js';

/**
 * The window's images from installed plugins (TYTO-280, ADR 0119): when a compile may ask,
 * what a miss says when it may not, and that a failure is asked once per process.
 *
 * Against the real preview and export services and the pack the app ships, with a plugin in
 * process whose `fetch` counts its calls: every number asserted here is a call the plugin
 * received. `promo-curso` has an optional image slot, which is all a `test:` reference needs.
 */

const require_ = createRequire(import.meta.url);
const packDirectory = join(dirname(require_.resolve('@tyto/templates/package.json')), 'templates');

/** One PNG chunk: length, type, data, and the CRC of type and data. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

/** A 2×2 PNG of one colour, written here so no binary is checked in. */
function solidPng([red, green, blue]: readonly number[]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.from([0, red ?? 0, green ?? 0, blue ?? 0, red ?? 0, green ?? 0, blue ?? 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat([row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const LOGO = solidPng([12, 35, 64]);

const briefNaming = (reference: string): string =>
  [
    '---',
    'template: promo-curso',
    'formats: [grid-1x1]',
    `imagem: ${reference}`,
    '---',
    '',
    '::titulo',
    '  TESTE',
    '',
  ].join('\n');

let home: string;
let folder: string;
/** Every reference the plugin was asked for, in order. */
let asked: string[];
/** What the plugin answers: the logo, or a refusal. */
let failing: boolean;
let trust: SourceTrust | undefined;

const sourcesPlugin: Plugin = {
  id: 'fontes',
  manifest: {
    name: 'fontes',
    version: '1.0.0',
    engine: `>=${PLUGIN_API_VERSION}`,
    contributes: ['asset-source'],
    permissions: [],
  },
  activate: (host) =>
    host.registerAssetSource({
      id: 'test',
      schemes: ['test'],
      fetch: (reference) => {
        asked.push(reference);
        return Promise.resolve(
          failing
            ? err([diagnostic('E_ASSET_NOT_FOUND', { path: reference, searched: 'the server' })])
            : ok({ bytes: new Uint8Array(LOGO), mime: 'image/png' }),
        );
      },
    }),
};

const installed = (): LoadedPlugins => ({
  plugins: [sourcesPlugin],
  warnings: [],
  close: () => Promise.resolve(),
});

async function sources(): Promise<DesktopSources> {
  const contributed = windowPlugins(Promise.resolve(installed()));
  await contributed.ready;
  return desktopSources({
    home,
    assetSources: () => contributed.assetSources(),
    fontSources: () => contributed.fontSources(),
    trustFor: (directory) => Promise.resolve(directory === undefined ? undefined : trust),
  });
}

async function previewWith(pluginSources: DesktopSources) {
  return createPreviewService({
    fileSystem: nodeFileSystem(),
    sources: await createProjectSources({ fileSystem: nodeFileSystem(), builtIn: packDirectory }),
    pluginSources,
  });
}

const messages = (diagnostics: readonly { readonly code: string; readonly message: string }[]) =>
  diagnostics.filter(({ code }) => code === 'E_ASSET_SOURCE_FAILED').map(({ message }) => message);

const embeds = (html: string | undefined): boolean =>
  (html ?? '').includes(LOGO.toString('base64'));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'tyto-desktop-sources-home-'));
  folder = mkdtempSync(join(tmpdir(), 'tyto-desktop-sources-brief-'));
  asked = [];
  failing = false;
  trust = { trust: 'none' };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(folder, { recursive: true, force: true });
});

describe('when a compile may ask a plugin (ADR 0119)', () => {
  it.each([
    ['typing', { trust: 'trusted' }, false, NOT_FETCHED.typing],
    ['save', { trust: 'trusted' }, true, undefined],
    ['save', { trust: 'none' }, true, undefined],
    ['save', { trust: 'restricted', open: true }, false, NOT_FETCHED.restricted],
    ['save', { trust: 'restricted' }, false, NOT_FETCHED.restrictedElsewhere],
    ['export', { trust: 'trusted' }, true, undefined],
    ['export', { trust: 'restricted', open: true }, false, NOT_FETCHED.restricted],
    ['queue', { trust: 'trusted' }, false, NOT_FETCHED.queue],
    ['save', undefined, false, NOT_FETCHED.unsaved],
  ] as const)('%s with %o fetches: %s', async (intent, answer, fetches, because) => {
    trust = answer;
    const call = await (await sources()).callFor(folder, intent);
    expect(call.fetches).toBe(fetches);
    expect(call.notFetchedBecause).toBe(because);
  });
});

describe('the preview, with a plugin that supplies images', () => {
  it('asks nothing while typing, fetches on a save, and reads the cache from then on', async () => {
    const preview = await previewWith(await sources());
    const brief = briefNaming('test:logo');

    const typed = await preview.preview(brief, folder, 'typing');
    expect(asked).toEqual([]);
    expect(messages(typed.diagnostics)).toEqual([expect.stringContaining(NOT_FETCHED.typing)]);

    const saved = await preview.preview(brief, folder, 'save');
    expect(asked).toEqual(['test:logo']);
    expect(messages(saved.diagnostics)).toEqual([]);
    expect(embeds(saved.frames[0]?.html)).toBe(true);

    const typedAgain = await preview.preview(brief, folder, 'typing');
    expect(asked).toEqual(['test:logo']);
    expect(embeds(typedAgain.frames[0]?.html)).toBe(true);
  });

  it('never asks for a half-typed reference on the way to a whole one', async () => {
    const preview = await previewWith(await sources());
    for (const partial of ['test:', 'test:l', 'test:lo', 'test:log', 'test:logo']) {
      await preview.preview(briefNaming(partial), folder, 'typing');
    }
    expect(asked).toEqual([]);
  });

  it('asks a failing reference once per process, says how to ask again, and asks a new one', async () => {
    failing = true;
    const preview = await previewWith(await sources());

    for (let save = 0; save < 3; save += 1) {
      const result = await preview.preview(briefNaming('test:logo'), folder, 'save');
      expect(messages(result.diagnostics)).toEqual([expect.stringContaining(ASK_AGAIN)]);
    }
    expect(asked).toEqual(['test:logo']);

    await preview.preview(briefNaming('test:outro'), folder, 'save');
    expect(asked).toEqual(['test:logo', 'test:outro']);
  });

  it('fetches nothing for a restricted folder, and names the command that trusts it', async () => {
    trust = { trust: 'restricted', open: true };
    const preview = await previewWith(await sources());

    const result = await preview.preview(briefNaming('test:logo'), folder, 'save');
    expect(asked).toEqual([]);
    expect(messages(result.diagnostics)).toEqual([expect.stringContaining(NOT_FETCHED.restricted)]);
  });
});

describe('the export, with the same cache', () => {
  async function exportWith(pluginSources: DesktopSources) {
    return createExportService({
      fileSystem: nodeFileSystem(),
      sources: await createProjectSources({ fileSystem: nodeFileSystem(), builtIn: packDirectory }),
      version: '0.0.0-test',
      plugins: Promise.resolve(installed()),
      pluginSources,
    });
  }

  it('fetches from the export box, and never for a queued task', async () => {
    const service = await exportWith(await sources());
    const brief = briefNaming('test:logo');
    const out = join(folder, 'out');
    writeFileSync(join(folder, 'promo.brief'), brief);

    const queued = await service.run({
      brief,
      directory: out,
      briefDirectory: folder,
      label: 'promo',
      outputs: [{ kind: 'svg' }],
      queued: true,
    });
    expect(asked).toEqual([]);
    expect(messages(queued.diagnostics)).toEqual([expect.stringContaining(NOT_FETCHED.queue)]);

    const exported = await service.run({
      brief,
      directory: out,
      briefDirectory: folder,
      label: 'promo',
      outputs: [{ kind: 'svg' }],
    });
    expect(asked).toEqual(['test:logo']);
    expect(messages(exported.diagnostics)).toEqual([]);

    // What the export box fetched, the queue now draws from the cache.
    const after = await service.run({
      brief,
      directory: out,
      briefDirectory: folder,
      label: 'promo',
      outputs: [{ kind: 'svg' }],
      queued: true,
    });
    expect(asked).toEqual(['test:logo']);
    expect(messages(after.diagnostics)).toEqual([]);
  });
});

describe('the fonts a preview draws in, with a plugin’s cache folder', () => {
  it('draws a local face over the one the plugin cached', () => {
    // PR B's fixture, read from the CLI's folder with its licence beside it.
    const face = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        '..',
        'packages',
        'command-line',
        'src',
        '__fixtures__',
        'plugin-sources',
        'TytoFixtureMono-Regular.ttf',
      ),
    );
    const local = join(folder, 'fonts');
    const cached = join(home, 'cache', 'sources', 'fontes', 'fonts');
    mkdirSync(local, { recursive: true });
    mkdirSync(cached, { recursive: true });
    // The same face with four bytes more: still a font, and told apart by what is embedded.
    const mine = Buffer.concat([face, Buffer.alloc(4)]);
    writeFileSync(join(local, 'TytoFixtureMono-Regular.ttf'), mine);
    writeFileSync(join(cached, 'tytofixturemono-400-normal-0123456789abcdef.ttf'), face);

    const uri = fontsFor([local], [cached]).fonts.font({
      font: { family: 'Tyto Fixture Mono', source: 'system' },
      weight: 400,
      style: 'normal',
    });
    expect(uri).toContain(mine.toString('base64'));
  });
});
