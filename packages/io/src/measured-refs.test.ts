import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type AssetResolver, ok } from '@tyto/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { briefAssetResolver } from './file-assets.js';
import { fileTemplateAssets } from './file-template-assets.js';
import { pngHeader } from './png-header.fixture.js';
import { sourceCache } from './source-cache.js';

/**
 * ADR 0158: every ref the host builds for a template carries the picture's pixel size, read
 * off the bytes it already holds to hash. The three places a ref reaching a template is
 * built: the brief's images (slots and supplied values), a plugin's asset source, and the
 * template's own folder (its pictures and its image defaults).
 *
 * Two sizes in each case, so a reader that answered a constant would fail.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-measured-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const nowhere: AssetResolver = { base: '/brief', resolve: () => Promise.resolve(undefined) };

describe('the size on a ref the host builds', () => {
  it('is read off a brief’s images, one size per picture', async () => {
    await writeFile(join(workspace, 'larga.png'), pngHeader(1600, 900));
    await writeFile(join(workspace, 'alta.png'), pngHeader(600, 1200));
    const resolver = briefAssetResolver({ briefDirectory: workspace });

    expect((await resolver.resolve('./larga.png'))?.size).toEqual({ w: 1600, h: 900 });
    expect((await resolver.resolve('./alta.png'))?.size).toEqual({ w: 600, h: 1200 });
  });

  it('is left out, not written as undefined, for a header nothing parses', async () => {
    await writeFile(join(workspace, 'quebrada.png'), 'not a picture');

    const ref = await briefAssetResolver({ briefDirectory: workspace }).resolve('./quebrada.png');

    expect(ref).toBeDefined();
    expect(ref !== undefined && 'size' in ref).toBe(false);
  });

  it('is read off what a plugin’s asset source served', async () => {
    const cache = sourceCache({
      home: workspace,
      assetSources: () => [
        {
          plugin: 'drive-ish',
          source: {
            id: 'test',
            schemes: ['test'],
            fetch: (reference: string) =>
              Promise.resolve(
                ok({
                  bytes: new Uint8Array(
                    reference === 'test:larga' ? pngHeader(1600, 900) : pngHeader(600, 1200),
                  ),
                  mime: 'image/png',
                }),
              ),
          },
        },
      ],
      fontSources: () => [],
      fetches: true,
    });

    const resolver = cache.assets(nowhere);
    expect((await resolver.resolve('test:larga'))?.size).toEqual({ w: 1600, h: 900 });
    expect((await resolver.resolve('test:alta'))?.size).toEqual({ w: 600, h: 1200 });
  });

  it('is read off the template’s own folder', async () => {
    const directory = join(workspace, 'cartaz');
    await mkdir(join(directory, 'assets'), { recursive: true });
    await writeFile(join(directory, 'assets', 'larga.png'), pngHeader(1600, 900));
    await writeFile(join(directory, 'assets', 'alta.png'), pngHeader(600, 1200));

    const { assets } = await fileTemplateAssets({ base: directory });

    expect(assets.image('assets/larga.png')?.size).toEqual({ w: 1600, h: 900 });
    expect(assets.image('assets/alta.png')?.size).toEqual({ w: 600, h: 1200 });
  });
});
