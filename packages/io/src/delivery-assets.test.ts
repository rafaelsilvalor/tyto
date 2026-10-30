import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AssetRef, AssetResolver } from '@tyto/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type DeliveredAsset, recordingAssetResolver } from './file-assets.js';
import { deliveryAssetsFolder, fsDeliveryExportOutput } from './fs-outbox.js';

/**
 * ADR 0161: a delivery's export copies the images its brief uses from elsewhere into the
 * delivery's assets folder, and never removes or replaces anything there.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-delivery-assets-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const delivery = () => join(workspace, 'mca-1');
const editable = () => join(delivery(), 'editaveis');
const assets = () => join(delivery(), 'assets');
const elsewhere = () => join(workspace, 'imagens');

async function place(path: string, bytes: string): Promise<string> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, bytes);
  return path;
}

/** The copy alone, as both callers drive it after a finished run. */
async function deliver(found: readonly DeliveredAsset[], report = editable()) {
  const opened = await fsDeliveryExportOutput({ artwork: delivery(), report });
  if (!opened.ok) throw new Error(opened.error.map((item) => item.message).join('\n'));
  return opened.value.deliverAssets(found);
}

const local = (path: string): DeliveredAsset => ({ reference: path, path });

describe('deliveryAssetsFolder', () => {
  it("reads ADR 0057's rule: editaveis/ means ../assets, any other folder its own assets/", () => {
    expect(deliveryAssetsFolder(editable())).toBe(assets());
    expect(deliveryAssetsFolder(delivery())).toBe(assets());
    expect(deliveryAssetsFolder(join(delivery(), 'x', 'y'))).toBe(
      join(delivery(), 'x', 'y', 'assets'),
    );
  });
});

describe("a delivery's export copies the brief's images", () => {
  it('copies an image from outside the delivery into assets/ and leaves the brief as written', async () => {
    const brief = await place(join(editable(), 'mca-1.brief'), 'image: ../../imagens/foto.png');
    const foto = await place(join(elsewhere(), 'foto.png'), 'a photo');

    expect(await deliver([local(foto)])).toEqual([]);

    expect(await readFile(join(assets(), 'foto.png'), 'utf8')).toBe('a photo');
    expect(await readFile(brief, 'utf8')).toBe('image: ../../imagens/foto.png');
  });

  it('copies into the root assets/ for a brief kept at the root ("brief": ".")', async () => {
    const foto = await place(join(elsewhere(), 'foto.png'), 'a photo');

    expect(await deliver([local(foto)], delivery())).toEqual([]);

    expect(await readdir(assets())).toEqual(['foto.png']);
    expect(await readdir(delivery())).toEqual(['assets']);
  });

  it('leaves an image already inside assets/, at any depth, where it is', async () => {
    const inside = await place(join(assets(), 'fotos', 'capa.png'), 'the cover');
    // Reached the way a brief in editaveis/ writes it, through `..`.
    const spelt = join(editable(), '..', 'assets', 'fotos', 'capa.png');

    expect(await deliver([local(inside), { reference: 'capa', path: spelt }])).toEqual([]);

    expect(await readdir(assets())).toEqual(['fotos']);
  });

  it('skips a same-named file with the same bytes in silence', async () => {
    await place(join(assets(), 'foto.png'), 'a photo');
    const foto = await place(join(elsewhere(), 'foto.png'), 'a photo');

    expect(await deliver([local(foto)])).toEqual([]);
    expect(await readdir(assets())).toEqual(['foto.png']);
  });

  it("keeps the person's same-named file with other bytes, and says so naming both", async () => {
    await place(join(assets(), 'foto.png'), 'the person’s photo');
    const foto = await place(join(elsewhere(), 'foto.png'), 'another photo');

    const answered = await deliver([local(foto)]);

    expect(answered.map((item) => item.code)).toEqual(['W_DELIVERY_ASSET_KEPT']);
    expect(answered[0]?.message).toContain(join(assets(), 'foto.png'));
    expect(answered[0]?.message).toContain(foto);
    expect(await readFile(join(assets(), 'foto.png'), 'utf8')).toBe('the person’s photo');
  });

  it('never removes a file from assets/, used or not, across two exports', async () => {
    await place(join(assets(), 'antiga.png'), 'an older image');
    const first = await place(join(elsewhere(), 'primeira.png'), 'first');
    const second = await place(join(elsewhere(), 'segunda.png'), 'second');

    await deliver([local(first)]);
    await deliver([local(second)]);

    expect((await readdir(assets())).sort()).toEqual(['antiga.png', 'primeira.png', 'segunda.png']);
  });

  it('names a fetched image after its reference (ADR 0118), and a warning by that reference', async () => {
    const cached = await place(join(workspace, 'cache', `${'a'.repeat(64)}.png`), 'fetched');
    const reference = 'drive:pasta/Logo Final.png';

    expect(await deliver([{ reference, path: cached, fetched: true }])).toEqual([]);
    expect(await readdir(assets())).toEqual(['Logo-Final.png']);

    await writeFile(join(assets(), 'Logo-Final.png'), 'edited by hand');
    const answered = await deliver([{ reference, path: cached, fetched: true }]);
    expect(answered[0]?.message).toContain(reference);
  });

  it('tells two different files of one name apart with -2, compared without case', async () => {
    const one = await place(join(elsewhere(), 'a', 'logo.png'), 'one');
    const two = await place(join(elsewhere(), 'b', 'LOGO.png'), 'two');

    await deliver([local(one), local(two), local(one)]);

    expect((await readdir(assets())).sort()).toEqual(['LOGO-2.png', 'logo.png']);
  });

  it('answers a file holding the name assets instead of throwing', async () => {
    await place(assets(), 'not a folder');
    const foto = await place(join(elsewhere(), 'foto.png'), 'a photo');

    const answered = await deliver([local(foto)]);

    expect(answered.map((item) => item.code)).toEqual(['E_DELIVERY_FOLDER_BLOCKED']);
  });

  it('makes no assets/ when every image is already inside it', async () => {
    expect(await deliver([])).toEqual([]);
    expect(await readdir(delivery())).toEqual(['editaveis']);
  });
});

describe('recordingAssetResolver', () => {
  it('records each file the inner resolver found, marking what the source cache supplied', async () => {
    const answers: Record<string, AssetRef | undefined> = {
      'foto.png': { path: '/disk/foto.png', source: 'file' } as AssetRef,
      'test:logo': { path: '/cache/abc.png', source: 'url' } as AssetRef,
      'missing.png': undefined,
    };
    const inner: AssetResolver = {
      base: '/disk',
      resolve: (reference) => Promise.resolve(answers[reference]),
    };
    const { resolver, delivered } = recordingAssetResolver(inner);

    for (const reference of Object.keys(answers)) await resolver.resolve(reference);

    expect(delivered()).toEqual([
      { reference: 'foto.png', path: '/disk/foto.png' },
      { reference: 'test:logo', path: '/cache/abc.png', fetched: true },
    ]);
  });
});
