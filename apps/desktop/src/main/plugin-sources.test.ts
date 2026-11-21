import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import {
  type Plugin,
  PLUGIN_API_VERSION,
  type LoadedPlugins,
  decodeGrants,
} from '@tyto/plugin-api';
import { err, ok, diagnostic } from '@tyto/core';
import { nodeFileSystem } from '@tyto/io';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createExportService } from './export.js';
import { fontsFor } from './fonts.js';
import {
  ASK_AGAIN,
  type DesktopSources,
  NOT_DECODED,
  NOT_FETCHED,
  desktopSources,
} from './plugin-sources.js';
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
const OTHER = solidPng([200, 40, 40]);

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

/** Every decode the stand-in decoder answered: the file's name, size and layer. */
let decoded: string[];

/**
 * A stand-in `image-decoder` for `.fake` (ADR 0223): it draws the logo for a file of one size
 * and the other colour for any other, so a rewritten file is told apart by what is embedded.
 * In process, it reads nothing through its token; the e2e reads through the real one.
 */
const decoderPlugin: Plugin = {
  id: 'decodificador',
  manifest: {
    name: 'decodificador',
    version: '1.0.0',
    engine: `>=${PLUGIN_API_VERSION}`,
    contributes: ['image-decoder'],
    permissions: [],
  },
  activate: (host) =>
    host.registerImageDecoder({
      id: 'fake',
      extensions: ['.fake'],
      decode: (file, request) => {
        decoded.push(`${file.name} ${String(file.size)} ${request.layer ?? ''}`);
        return ok({ bytes: new Uint8Array(file.size === 4 ? LOGO : OTHER) });
      },
    }),
};

const installed = (plugins: readonly Plugin[] = [sourcesPlugin, decoderPlugin]): LoadedPlugins => ({
  plugins,
  warnings: [],
  close: () => Promise.resolve(),
});

async function sources(plugins?: readonly Plugin[]): Promise<DesktopSources> {
  const contributed = windowPlugins(Promise.resolve(installed(plugins)));
  await contributed.ready;
  const grants = decodeGrants();
  return desktopSources({
    home,
    assetSources: () => contributed.assetSources(),
    fontSources: () => contributed.fontSources(),
    trustFor: (directory) => Promise.resolve(directory === undefined ? undefined : trust),
    decoders: {
      imageDecoders: () => contributed.imageDecoders(),
      decode: (decoder, subject, request) => grants.decode(decoder, subject, request),
      versionOf: (plugin) => contributed.versionOf(plugin),
    },
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
  decoded = [];
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

describe('when a compile may ask a plugin to decode (ADR 0223)', () => {
  it.each([
    ['typing', { trust: 'trusted' }, true, undefined],
    ['typing', { trust: 'none' }, true, undefined],
    ['save', { trust: 'trusted' }, true, undefined],
    ['save', { trust: 'restricted', open: true }, false, NOT_DECODED.restricted],
    ['typing', { trust: 'restricted' }, false, NOT_DECODED.restrictedElsewhere],
    ['export', { trust: 'trusted' }, true, undefined],
    ['queue', { trust: 'restricted', open: true }, true, undefined],
    ['save', undefined, false, NOT_DECODED.unsaved],
  ] as const)('%s with %o decodes: %s', async (intent, answer, decodes, because) => {
    trust = answer;
    const call = await (await sources()).callFor(folder, intent);
    expect(call.decoding.decodes).toBe(decodes);
    expect(call.decoding.notDecodedBecause).toBe(because);
  });
});

describe('the preview, with a plugin that decodes a file kind (ADR 0223)', () => {
  const embedsOther = (html: string | undefined): boolean =>
    (html ?? '').includes(OTHER.toString('base64'));

  it('draws the layer while typing, names the cited file, and redraws a rewritten one', async () => {
    const preview = await previewWith(await sources());
    const brief = briefNaming('capa.fake#arte');
    writeFileSync(join(folder, 'capa.fake'), 'four');

    const first = await preview.preview(brief, folder, 'typing');
    expect(decoded).toEqual(['capa.fake 4 arte']);
    expect(embeds(first.frames[0]?.html)).toBe(true);
    // The file whose change redraws the preview, never the cached PNG (TYTO-741's redraw).
    expect(first.references).toContain('capa.fake');
    expect(first.references.some((reference) => reference.endsWith('.png'))).toBe(false);

    // The same file again is the cache's: the plugin is not asked twice.
    await preview.preview(brief, folder, 'typing');
    expect(decoded).toHaveLength(1);

    writeFileSync(join(folder, 'capa.fake'), 'painted again');
    const redrawn = await preview.preview(brief, folder, 'typing');
    expect(decoded).toEqual(['capa.fake 4 arte', 'capa.fake 13 arte']);
    expect(embedsOther(redrawn.frames[0]?.html)).toBe(true);
  });

  it('serves a restricted folder the cache only, and says to trust it on a miss', async () => {
    writeFileSync(join(folder, 'capa.fake'), 'four');
    const preview = await previewWith(await sources());
    await preview.preview(briefNaming('capa.fake'), folder, 'typing');
    expect(decoded).toHaveLength(1);

    trust = { trust: 'restricted', open: true };
    const cached = await preview.preview(briefNaming('capa.fake'), folder, 'typing');
    expect(embeds(cached.frames[0]?.html)).toBe(true);
    const missed = await preview.preview(briefNaming('capa.fake#outra'), folder, 'save');
    expect(decoded).toHaveLength(1);
    const failed = missed.diagnostics.filter(({ code }) => code === 'E_ASSET_DECODE_FAILED');
    expect(failed.map(({ message }) => message)).toEqual([
      expect.stringContaining(NOT_DECODED.restricted),
    ]);
  });

  it('says a plugin is needed, at the line, when none decodes the extension', async () => {
    writeFileSync(join(folder, 'capa.fake'), 'four');
    const preview = await previewWith(await sources([sourcesPlugin]));
    const brief = briefNaming('capa.fake#arte');
    const result = await preview.preview(brief, folder, 'save');
    const missing = result.diagnostics.filter(({ code }) => code === 'E_ASSET_DECODER_MISSING');
    expect(missing).toHaveLength(1);
    // The editor underlines what the range covers, on the line that cites the file.
    const start = missing[0]?.range?.start ?? -1;
    expect(start).toBeGreaterThan(0);
    const line = brief.slice(brief.lastIndexOf('\n', start) + 1, brief.indexOf('\n', start));
    expect(line).toBe('imagem: capa.fake#arte');
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

  it("draws a decoded file through the run's own decoders (ADR 0223)", async () => {
    const service = await exportWith(await sources());
    const brief = briefNaming('capa.fake#arte');
    const out = join(folder, 'out');
    writeFileSync(join(folder, 'capa.fake'), 'four');

    const exported = await service.run({
      brief,
      directory: out,
      briefDirectory: folder,
      label: 'promo',
      outputs: [{ kind: 'svg' }],
    });
    expect(exported.diagnostics.filter(({ code }) => code.startsWith('E_'))).toEqual([]);
    expect(decoded).toEqual(['capa.fake 4 arte']);
    const written = readdirSync(out, { recursive: true, encoding: 'utf8' }).filter((name) =>
      name.endsWith('.svg'),
    );
    expect(written).toHaveLength(1);
    const svg = readFileSync(join(out, written[0] ?? ''), 'utf8');
    expect(svg).toContain(LOGO.toString('base64'));
  });

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
