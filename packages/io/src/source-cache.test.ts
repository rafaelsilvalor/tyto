import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { type AssetResolver, type FontFace, err, ok, diagnostic } from '@tyto/core';
import {
  ASSET_SOURCE_MAX_BYTES,
  type AssetSourceContribution,
  type FontSourceContribution,
  type SourceRequest,
  type SourcedAsset,
} from '@tyto/plugin-api';
import { afterEach, describe, expect, it } from 'vitest';

import { hashOf } from './hash.js';
import { sourceCache } from './source-cache.js';

/**
 * The cache is the whole of what makes a plugin's bytes reachable from the synchronous
 * ports, so these tests are about the three things it promises: one fetch per entry,
 * nothing fetched for a folder nobody trusted, and a miss that says why (ADR 0117).
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FACE: FontFace = { family: 'Inter', weight: 700, style: 'italic' };
const OUTLINES = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x42]);

const homes: string[] = [];
function home(): string {
  const path = mkdtempSync(join(tmpdir(), 'tyto-source-cache-'));
  homes.push(path);
  return path;
}
afterEach(() => {
  for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** A disk with nothing on it: every reference the cache does not claim is a miss. */
const nowhere: AssetResolver = {
  base: '/brief',
  resolve: () => Promise.resolve(undefined),
};

interface Counted<T> {
  readonly source: T;
  readonly asked: unknown[][];
}

function assetSource(
  answer: (reference: string) => ReturnType<AssetSourceContribution['fetch']> = () =>
    ok<SourcedAsset>({ bytes: PNG, mime: 'image/png' }),
): Counted<AssetSourceContribution> {
  const asked: unknown[][] = [];
  return {
    asked,
    source: {
      id: 'test',
      schemes: ['test'],
      fetch: (reference: string, request: SourceRequest) => {
        asked.push([reference, request]);
        return answer(reference);
      },
    },
  };
}

function fontSource(
  answer: () => ReturnType<FontSourceContribution['fetch']> = () => ok(OUTLINES),
): Counted<FontSourceContribution> {
  const asked: unknown[][] = [];
  return {
    asked,
    source: {
      id: 'faces',
      families: ['Inter'],
      fetch: (face: FontFace, request: SourceRequest) => {
        asked.push([face, request]);
        return answer();
      },
    },
  };
}

function cacheOf(
  tytoHome: string,
  sources: {
    readonly assets?: AssetSourceContribution;
    readonly fonts?: FontSourceContribution;
    readonly fetches?: boolean;
    readonly section?: unknown;
  },
) {
  return sourceCache({
    home: tytoHome,
    assetSources: () =>
      sources.assets === undefined ? [] : [{ plugin: 'drive-ish', source: sources.assets }],
    fontSources: () =>
      sources.fonts === undefined ? [] : [{ plugin: 'drive-ish', source: sources.fonts }],
    sectionOf: () => sources.section,
    fetches: sources.fetches ?? true,
  });
}

function filesUnder(path: string): string[] {
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(path, join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
}

describe('an asset a plugin serves', () => {
  it('is fetched once, and the next render reads the cache without asking', async () => {
    const tytoHome = home();
    const counted = assetSource();

    const first = await cacheOf(tytoHome, { assets: counted.source })
      .assets(nowhere)
      .resolve('test:logo');
    // A second cache over the same home is a second run of the program.
    const second = await cacheOf(tytoHome, { assets: counted.source })
      .assets(nowhere)
      .resolve('test:logo');

    expect(counted.asked).toHaveLength(1);
    expect(first).toEqual(second);
    expect(first?.id).toBe('test:logo');
    expect(first?.hash).toBe(hashOf(PNG));
    expect(new Uint8Array(readFileSync(first?.path ?? ''))).toEqual(PNG);
  });

  it('is cached under a hash of the reference, never under its text', async () => {
    const tytoHome = home();
    const counted = assetSource();
    await cacheOf(tytoHome, { assets: counted.source })
      .assets(nowhere)
      .resolve('test:../../../escaped.png');

    const files = filesUnder(tytoHome);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^cache\/sources\/drive-ish\/[0-9a-f]{64}\.png$/);
  });

  it('carries the plugin its own project section, and nothing when there is none', async () => {
    const counted = assetSource();
    await cacheOf(home(), { assets: counted.source, section: { folder: 'abc' } })
      .assets(nowhere)
      .resolve('test:a');
    await cacheOf(home(), { assets: counted.source }).assets(nowhere).resolve('test:b');

    expect(counted.asked).toEqual([
      ['test:a', { section: { folder: 'abc' } }],
      ['test:b', {}],
    ]);
  });

  it('leaves every reference in an unclaimed scheme, and every path, to the resolver below', async () => {
    const counted = assetSource();
    const asked: string[] = [];
    const inner: AssetResolver = {
      base: '/brief',
      resolve: (reference) => {
        asked.push(reference);
        return Promise.resolve(undefined);
      },
    };
    const assets = cacheOf(home(), { assets: counted.source }).assets(inner);
    await assets.resolve('drive:abc');
    await assets.resolve('C:\\art\\logo.png');
    await assets.resolve('logo.png');

    expect(counted.asked).toEqual([]);
    expect(asked).toEqual(['drive:abc', 'C:\\art\\logo.png', 'logo.png']);
    expect(assets.explain?.('drive:abc')).toBeUndefined();
  });
});

describe('an asset a plugin could not supply', () => {
  it('is a miss that names the plugin and its reason', async () => {
    const counted = assetSource(() =>
      err([diagnostic('E_PLUGIN_CALL', { plugin: 'x', problem: 'quota exceeded' })]),
    );
    const assets = cacheOf(home(), { assets: counted.source }).assets(nowhere);

    expect(await assets.resolve('test:logo')).toBeUndefined();
    const explained = assets.explain?.('test:logo');
    expect(explained?.code).toBe('E_ASSET_SOURCE_FAILED');
    expect(explained?.message).toContain("plugin 'drive-ish'");
    expect(explained?.message).toContain('quota exceeded');
  });

  it('refuses an answer over the ceiling, and writes nothing', async () => {
    const tytoHome = home();
    const counted = assetSource(() =>
      ok({ bytes: new Uint8Array(ASSET_SOURCE_MAX_BYTES + 1), mime: 'image/png' }),
    );
    const assets = cacheOf(tytoHome, { assets: counted.source }).assets(nowhere);

    expect(await assets.resolve('test:huge')).toBeUndefined();
    expect(assets.explain?.('test:huge')?.message).toContain('over the');
    expect(filesUnder(tytoHome)).toEqual([]);
  });

  it('refuses a type a document cannot embed', async () => {
    const counted = assetSource(() => ok({ bytes: PNG, mime: 'application/pdf' }));
    const assets = cacheOf(home(), { assets: counted.source }).assets(nowhere);

    expect(await assets.resolve('test:doc')).toBeUndefined();
    expect(assets.explain?.('test:doc')?.message).toContain("'application/pdf'");
  });

  it('is a miss, not a rejection, when the source throws', async () => {
    const counted = assetSource(() => {
      throw new Error('socket hang up');
    });
    const assets = cacheOf(home(), { assets: counted.source }).assets(nowhere);

    expect(await assets.resolve('test:logo')).toBeUndefined();
    expect(assets.explain?.('test:logo')?.message).toContain('socket hang up');
  });
});

describe('a restricted folder (ADR 0111, ADR 0117)', () => {
  it('asks no plugin for anything, and says to trust the folder', async () => {
    const counted = assetSource();
    const assets = cacheOf(home(), { assets: counted.source, fetches: false }).assets(nowhere);

    expect(await assets.resolve('test:logo')).toBeUndefined();
    expect(counted.asked).toEqual([]);
    expect(assets.explain?.('test:logo')?.message).toContain('trust the folder to fetch');
  });

  it('still reads what a trusted run already cached', async () => {
    const tytoHome = home();
    const counted = assetSource();
    const trusted = await cacheOf(tytoHome, { assets: counted.source })
      .assets(nowhere)
      .resolve('test:logo');
    const restricted = await cacheOf(tytoHome, { assets: counted.source, fetches: false })
      .assets(nowhere)
      .resolve('test:logo');

    expect(counted.asked).toHaveLength(1);
    expect(restricted).toEqual(trusted);
  });

  it('says the caller’s own reason when it never fetches for another one (ADR 0118)', async () => {
    const counted = assetSource();
    const fonts = fontSource();
    const cache = sourceCache({
      home: home(),
      assetSources: () => [{ plugin: 'drive-ish', source: counted.source }],
      fontSources: () => [{ plugin: 'drive-ish', source: fonts.source }],
      fetches: false,
      notFetchedBecause: 'tyto watch never fetches',
    });
    const assets = cache.assets(nowhere);

    expect(await assets.resolve('test:logo')).toBeUndefined();
    expect(assets.explain?.('test:logo')?.message).toContain('tyto watch never fetches');
    expect(assets.explain?.('test:logo')?.message).not.toContain('trust the folder');
    const faces = await cache.fetchFaces([FACE]);
    expect(faces.diagnostics[0]?.message).toContain('tyto watch never fetches');
    expect([...counted.asked, ...fonts.asked]).toEqual([]);
  });

  it('fetches no face either', async () => {
    const counted = fontSource();
    const cache = cacheOf(home(), { fonts: counted.source, fetches: false });
    const answer = await cache.fetchFaces([FACE]);

    expect(counted.asked).toEqual([]);
    expect(answer.fetched).toBe(0);
    expect(answer.diagnostics.map((item) => item.code)).toEqual(['W_FONT_SOURCE_FAILED']);
    expect(answer.diagnostics[0]?.message).toContain('trust the folder to fetch');
  });
});

describe('a face a plugin serves', () => {
  it('is written into the folder the font library searches, once', async () => {
    const tytoHome = home();
    const counted = fontSource();
    const cache = cacheOf(tytoHome, { fonts: counted.source });

    expect(await cache.fetchFaces([FACE])).toEqual({ fetched: 1, diagnostics: [] });
    // Asked again — the library did not find it, or another job asks — and not fetched.
    expect(await cacheOf(tytoHome, { fonts: counted.source }).fetchFaces([FACE])).toEqual({
      fetched: 0,
      diagnostics: [],
    });

    expect(counted.asked).toEqual([[FACE, {}]]);
    const [folder] = cache.fontDirectories();
    const files = readdirSync(folder ?? '');
    expect(files).toHaveLength(1);
    // The family leads the name: the library opens only files named after the family.
    expect(files[0]).toMatch(/^inter-700-italic-[0-9a-f]{16}\.ttf$/);
    expect(new Uint8Array(readFileSync(join(folder ?? '', files[0] ?? '')))).toEqual(OUTLINES);
  });

  it('is left alone when no font source names its family', async () => {
    const counted = fontSource();
    const answer = await cacheOf(home(), { fonts: counted.source }).fetchFaces([
      { family: 'Roboto', weight: 400, style: 'normal' },
    ]);

    expect(counted.asked).toEqual([]);
    expect(answer).toEqual({ fetched: 0, diagnostics: [] });
  });

  it('that failed is asked for once, and reported on every pass', async () => {
    const counted = fontSource(() => {
      throw new Error('quota exceeded');
    });
    const cache = cacheOf(home(), { fonts: counted.source });
    const first = await cache.fetchFaces([FACE]);
    const second = await cache.fetchFaces([FACE]);

    expect(counted.asked).toHaveLength(1);
    expect(first.diagnostics.map((item) => item.message)).toEqual(
      second.diagnostics.map((item) => item.message),
    );
    expect(first.diagnostics[0]?.message).toContain("Font 'Inter 700 italic'");
    expect(first.diagnostics[0]?.message).toContain('quota exceeded');
  });

  it('refuses a face over the ceiling', async () => {
    const counted = fontSource(() => ok(new Uint8Array(16 * 1024 * 1024 + 1)));
    const answer = await cacheOf(home(), { fonts: counted.source }).fetchFaces([FACE]);

    expect(answer.fetched).toBe(0);
    expect(answer.diagnostics[0]?.message).toContain('over the');
  });
});
