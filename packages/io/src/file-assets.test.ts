import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { briefAssetResolver } from './file-assets.js';
import { hashOf } from './hash.js';

/**
 * ADR 0056: an asset path is the path as written, read from the brief's folder first and
 * from `assets/` beside the brief when nothing is there.
 *
 * Bytes rather than real images: the resolver hashes and locates, it does not decode, and
 * two files that differ by one letter are the plainest proof of *which* file was read.
 */

let workspace: string;
let briefs: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-assets-'));
  briefs = join(workspace, 'briefs');
  await mkdir(join(briefs, 'assets'), { recursive: true });
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const IN_ASSETS = Buffer.from('the one in assets/');
const BESIDE = Buffer.from('the one beside the brief');

describe('briefAssetResolver', () => {
  it('finds ./calendario.png in assets/ when the brief folder has none (Jacurutu shape)', async () => {
    await writeFile(join(briefs, 'assets', 'calendario.png'), IN_ASSETS);

    const asset = await briefAssetResolver({ briefDirectory: briefs }).resolve('./calendario.png');

    expect(asset?.id).toBe('./calendario.png');
    expect(asset?.path).toBe(join(briefs, 'assets', 'calendario.png'));
    expect(asset?.hash).toBe(hashOf(IN_ASSETS));
  });

  it('reads ./assets/calendario.png as written, from the brief folder', async () => {
    await writeFile(join(briefs, 'assets', 'calendario.png'), IN_ASSETS);

    const asset = await briefAssetResolver({ briefDirectory: briefs }).resolve(
      './assets/calendario.png',
    );

    expect(asset?.path).toBe(join(briefs, 'assets', 'calendario.png'));
    expect(asset?.hash).toBe(hashOf(IN_ASSETS));
  });

  it('reads an image beside the brief', async () => {
    await writeFile(join(briefs, 'calendario.png'), BESIDE);

    const asset = await briefAssetResolver({ briefDirectory: briefs }).resolve('./calendario.png');

    expect(asset?.path).toBe(join(briefs, 'calendario.png'));
  });

  it('uses the literal path when both exist', async () => {
    await writeFile(join(briefs, 'calendario.png'), BESIDE);
    await writeFile(join(briefs, 'assets', 'calendario.png'), IN_ASSETS);

    const asset = await briefAssetResolver({ briefDirectory: briefs }).resolve('./calendario.png');

    // The bytes' hash, not only the path: the file that was read is the one beside the brief.
    expect(asset?.hash).toBe(hashOf(BESIDE));
    expect(asset?.path).toBe(join(briefs, 'calendario.png'));
  });

  it('gives the same hash for the same bytes whichever folder they were found in', async () => {
    const other = join(workspace, 'other');
    await mkdir(join(other, 'assets'), { recursive: true });
    await writeFile(join(briefs, 'selo.png'), IN_ASSETS);
    await writeFile(join(other, 'assets', 'selo.png'), IN_ASSETS);

    const beside = await briefAssetResolver({ briefDirectory: briefs }).resolve('./selo.png');
    const fallback = await briefAssetResolver({ briefDirectory: other }).resolve('./selo.png');

    // Where differs; what does not. ADR 0003 keys on the bytes, so the artwork is identical.
    expect(beside?.path).not.toBe(fallback?.path);
    expect(beside?.hash).toBe(fallback?.hash);
  });

  it('refuses a path that climbs out of the brief folder, in assets/ too', async () => {
    // `../secret.txt` read against `assets/` would land on this file, inside the brief's
    // folder. `assets/` is its own containment root, so the fallback refuses it as well.
    await writeFile(join(briefs, 'secret.txt'), 'inside the brief folder');
    await writeFile(join(workspace, 'secret.txt'), 'outside everything');

    const resolver = briefAssetResolver({ briefDirectory: briefs });

    expect(await resolver.resolve('../secret.txt')).toBeUndefined();
  });

  it('refuses an absolute path outside both folders', async () => {
    await writeFile(join(workspace, 'secret.txt'), 'outside everything');

    const resolver = briefAssetResolver({ briefDirectory: briefs });

    expect(await resolver.resolve(join(workspace, 'secret.txt'))).toBeUndefined();
  });

  it('answers undefined for a file in neither folder, naming the brief folder as its base', async () => {
    const resolver = briefAssetResolver({ briefDirectory: briefs });

    expect(await resolver.resolve('./sumiu.png')).toBeUndefined();
    expect(resolver.base).toBe(briefs);
  });
});
