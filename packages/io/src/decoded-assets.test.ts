import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type AssetResolver,
  type BriefAst,
  type TemplateRegistry,
  diagnostic,
  err,
  ok,
  parseManifest,
  resolve,
  sourceRange,
} from '@tyto/core';
import {
  type DecodeFile,
  type DecodeRequest,
  type OwnedImageDecoder,
  decodeGrants,
} from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type DecodeCall,
  type DecodedSourceFiles,
  decodedAssets,
  nodeDecodedSourceFiles,
} from './decoded-assets.js';
import { briefAssetResolver, recordingAssetResolver } from './file-assets.js';
import { fsDeliveryExportOutput } from './fs-outbox.js';
import { hashOf } from './hash.js';
import { pngHeader } from './png-header.fixture.js';

/**
 * A plugin's `image-decoder` behind the asset port (TYTO-742, ADR 0223), with a stand-in
 * decoder: it reads the file through its token and answers a PNG header whose width is the
 * file's length, so a changed file is a changed picture. No real PSD is involved.
 */

let workspace: string;
let briefs: string;
let tytoHome: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-decoded-'));
  briefs = join(workspace, 'peca');
  tytoHome = join(workspace, 'home');
  await mkdir(join(briefs, 'assets'), { recursive: true });
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** The token table a host keeps, shared by the decode port and the plugin's reads. */
function standIn(answer?: (file: DecodeFile, request: DecodeRequest) => Uint8Array | string) {
  const grants = decodeGrants();
  const calls: { name: string; layer?: string }[] = [];
  const decoder: OwnedImageDecoder = {
    plugin: 'stand-in',
    source: {
      id: 'stand-in',
      extensions: ['.psd'],
      async decode(file, request) {
        calls.push({ name: file.name, ...request });
        const read = await grants.readPart('stand-in', file.token, 0, file.size);
        const answered = answer?.(file, request) ?? pngHeader(read.byteLength, 1);
        return typeof answered === 'string'
          ? err([diagnostic('E_PLUGIN_CALL', { plugin: 'stand-in', problem: answered })])
          : ok({ bytes: answered });
      },
    },
  };
  return { decoder, calls, decode: grants.decode.bind(grants) };
}

/** Node's disk, counting how many times a whole source file is hashed. */
function counted(): { files: DecodedSourceFiles; hashed: string[] } {
  const hashed: string[] = [];
  return {
    hashed,
    files: {
      ...nodeDecodedSourceFiles,
      hash: (path) => {
        hashed.push(path);
        return nodeDecodedSourceFiles.hash(path);
      },
    },
  };
}

function cacheOver(
  plugin: ReturnType<typeof standIn>,
  options: { decodes?: boolean; files?: DecodedSourceFiles; version?: string } = {},
) {
  return decodedAssets({
    home: tytoHome,
    decoders: () => [plugin.decoder],
    decode: plugin.decode,
    versionOf: () => options.version ?? '1.0.0',
    decodes: options.decodes ?? true,
    ...(options.files === undefined ? {} : { files: options.files }),
  });
}

function assetsOf(cache: ReturnType<typeof cacheOver>, call?: DecodeCall): AssetResolver {
  return cache.assets(briefAssetResolver({ briefDirectory: briefs }), call);
}

async function place(name: string, bytes: string): Promise<string> {
  const path = join(briefs, 'assets', name);
  await writeFile(path, bytes);
  return path;
}

describe('a file a plugin decodes', () => {
  it('is located without being read, decoded once, and served as the cached PNG', async () => {
    await place('capa.psd', 'layered');
    const plugin = standIn();
    const assets = assetsOf(cacheOver(plugin));

    const asset = await assets.resolve('capa.psd');

    expect(plugin.calls).toEqual([{ name: 'capa.psd' }]);
    expect(asset).toMatchObject({ id: 'capa.psd', source: 'url', size: { w: 7, h: 1 } });
    expect(asset?.path?.startsWith(join(tytoHome, 'cache', 'decoded', 'stand-in'))).toBe(true);
    expect(asset?.hash).toBe(hashOf(pngHeader(7, 1)));
  });

  it('asks the decoder for a layer after the last #, and the port says where it split', async () => {
    await place('capa.psd', 'layered');
    const plugin = standIn();
    const assets = assetsOf(cacheOver(plugin));

    expect(await assets.resolve('capa.psd#grupo/arte')).toBeDefined();

    expect(plugin.calls).toEqual([{ name: 'capa.psd', layer: 'grupo/arte' }]);
    expect(assets.layerOf?.('capa.psd#grupo/arte')).toEqual({
      file: 'capa.psd',
      layer: 'grupo/arte',
    });
  });

  it('reads a literal file whose name holds a # as that file, decoder or not', async () => {
    await place('post#1.png', 'a photo');
    await place('capa.psd#arte', 'a file named so');
    const plugin = standIn();
    const assets = assetsOf(cacheOver(plugin));

    expect((await assets.resolve('post#1.png'))?.source).toBe('file');
    // The literal name exists, so it is not a layer: the file resolver answers it as written.
    expect((await assets.resolve('capa.psd#arte'))?.source).toBe('file');
    expect(assets.layerOf?.('capa.psd#arte')).toBeUndefined();
    expect(plugin.calls).toEqual([]);
  });

  it('serves the cache on a second resolve without asking the decoder', async () => {
    await place('capa.psd', 'layered');
    const plugin = standIn();

    const first = await assetsOf(cacheOver(plugin)).resolve('capa.psd');
    // A second cache over the same home is a second run of the program.
    const second = await assetsOf(cacheOver(plugin)).resolve('capa.psd');

    expect(plugin.calls).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('decodes again when the file changes, and when the plugin is updated', async () => {
    const path = await place('capa.psd', 'layered');
    const plugin = standIn();
    const cache = cacheOver(plugin);

    await assetsOf(cache).resolve('capa.psd');
    await writeFile(path, 'repainted, longer');
    const repainted = await assetsOf(cache).resolve('capa.psd');
    await assetsOf(cacheOver(plugin, { version: '1.1.0' })).resolve('capa.psd');

    expect(plugin.calls).toHaveLength(3);
    expect(repainted?.size?.w).toBe('repainted, longer'.length);
  });

  it('hashes a file once while its path, size and modified time hold (the 300 MB re-read)', async () => {
    const path = await place('capa.psd', 'layered');
    const disk = counted();
    const cache = cacheOver(standIn(), { files: disk.files });

    for (let round = 0; round < 3; round += 1) await assetsOf(cache).resolve('capa.psd');
    expect(disk.hashed).toHaveLength(1);

    // Same size, a later modified time: the memo cannot know the bytes held, so it asks.
    await writeFile(path, 'LAYERED');
    const later = new Date(Date.now() + 60_000);
    await utimes(path, later, later);
    await assetsOf(cache).resolve('capa.psd');
    expect(disk.hashed).toHaveLength(2);
  });
});

describe('a file no picture is drawn from', () => {
  it('is E_ASSET_DECODER_MISSING when no plugin decodes it, naming the extension', async () => {
    await place('capa.psd', 'layered');
    const assets = decodedAssets({
      home: tytoHome,
      decoders: () => [],
      decode: () => Promise.reject(new Error('never asked')),
      decodes: true,
    }).assets(briefAssetResolver({ briefDirectory: briefs }));

    for (const reference of ['capa.psd', 'capa.psd#arte']) {
      expect(await assets.resolve(reference)).toBeUndefined();
      const said = assets.explain?.(reference);
      expect(said?.code).toBe('E_ASSET_DECODER_MISSING');
      expect(said?.message).toContain("'.psd'");
    }
  });

  it('is E_ASSET_NOT_FOUND, as any picture, when the file is not there', async () => {
    const plugin = standIn();
    const assets = assetsOf(cacheOver(plugin));

    expect(await assets.resolve('sumiu.psd')).toBeUndefined();
    expect(assets.explain?.('sumiu.psd')).toBeUndefined();
    expect(plugin.calls).toEqual([]);
  });

  it('is E_ASSET_DECODE_FAILED with the plugin’s message, never a blank picture', async () => {
    await place('capa.psd', 'layered');
    const failing = standIn(() => "no layer is named 'arte'");
    const notPng = standIn(() => new Uint8Array([1, 2, 3]));

    const one = assetsOf(cacheOver(failing));
    expect(await one.resolve('capa.psd#arte')).toBeUndefined();
    expect(one.explain?.('capa.psd#arte')?.message).toBe(
      "Asset 'capa.psd#arte' could not be decoded by plugin 'stand-in': " +
        "Plugin 'stand-in' threw while the host was calling it: no layer is named 'arte'..",
    );

    const two = assetsOf(cacheOver(notPng));
    expect(await two.resolve('capa.psd')).toBeUndefined();
    expect(two.explain?.('capa.psd')?.code).toBe('E_ASSET_DECODE_FAILED');
    expect(await readdir(join(tytoHome, 'cache', 'decoded')).catch(() => [])).toEqual([]);
  });

  it('reaches the brief’s line through resolve', async () => {
    await place('capa.psd', 'layered');
    const manifest = parseManifest(
      'name: arte\nversion: 1.0.0\nformats: [feed]\nslots:\n  foto: { type: image }\n',
      'manifest.yaml',
    );
    if (!manifest.ok) throw new Error('manifest');
    const registry: TemplateRegistry = {
      list: () => [manifest.value],
      get: () => manifest.value,
      formatsOf: () => manifest.value.formats,
      directoryOf: () => 'templates/arte',
      failures: [],
    };
    const at = sourceRange(20, 34);
    const ast: BriefAst = {
      frontmatter: {
        data: { template: 'arte', foto: 'capa.psd' },
        ranges: { foto: at },
        range: sourceRange(0, 40),
      },
      directives: [],
      range: sourceRange(0, 40),
    };
    const assets = decodedAssets({
      home: tytoHome,
      decoders: () => [],
      decode: () => Promise.reject(new Error('never asked')),
      decodes: true,
    }).assets(briefAssetResolver({ briefDirectory: briefs }));

    const result = await resolve(ast, { registry, assets });

    const problems = result.ok ? result.diagnostics : result.error;
    const [missing] = problems.filter((item) => item.code === 'E_ASSET_DECODER_MISSING');
    expect(missing?.range).toEqual(at);
  });
});

describe('an untrusted folder', () => {
  it('serves what is cached and asks no plugin for anything else', async () => {
    await place('capa.psd', 'layered');
    await place('fundo.psd', 'other');
    const plugin = standIn();
    await assetsOf(cacheOver(plugin)).resolve('capa.psd');

    const restricted = assetsOf(cacheOver(plugin, { decodes: false }));
    expect(await restricted.resolve('capa.psd')).toBeDefined();
    expect(await restricted.resolve('fundo.psd')).toBeUndefined();

    expect(plugin.calls).toHaveLength(1);
    const said = restricted.explain?.('fundo.psd');
    expect(said?.code).toBe('E_ASSET_DECODE_FAILED');
    expect(said?.message).toContain('trust the folder');
  });
});

describe('a guide cited as external art (ADR 0222, ADR 0223)', () => {
  it('is decoded per format from x.<format>.guide.psd', async () => {
    await place('capa.story.guide.psd', 'story paint');
    const plugin = standIn();
    const assets = assetsOf(cacheOver(plugin));

    expect(await assets.resolve('capa.story.guide.psd')).toBeDefined();
    expect(await assets.resolve('capa.feed.guide.psd')).toBeUndefined();
    expect(plugin.calls).toEqual([{ name: 'capa.story.guide.psd' }]);
  });
});

describe('a delivery of a decoded picture (ADR 0223, decision 9)', () => {
  it('copies the PNG named after the reference with its layer folded in', async () => {
    await place('capa.psd', 'layered');
    const { resolver, delivered } = recordingAssetResolver(assetsOf(cacheOver(standIn())));
    await resolver.resolve('capa.psd#grupo/arte');
    await resolver.resolve('capa.psd');

    const delivery = join(workspace, 'entrega');
    const opened = await fsDeliveryExportOutput({
      artwork: delivery,
      report: join(delivery, 'editaveis'),
    });
    if (!opened.ok) throw new Error('delivery');
    expect(await opened.value.deliverAssets(delivered())).toEqual([]);

    expect((await readdir(join(delivery, 'assets'))).sort()).toEqual([
      'capa-grupo-arte.png',
      'capa.png',
    ]);
  });
});
