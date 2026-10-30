import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  GALLERY_RECORD_FILE,
  fetchGalleryIndex,
  readGalleryRecord,
  writeGalleryRecord,
} from './gallery.js';

const exec = promisify(execFile);
const AUTHOR = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];

let root: string;
let home: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-gallery-'));
  home = join(root, 'home');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** An index repository with `text` as its `index.yaml` on its default branch; answers its URL. */
async function indexRepository(text: string): Promise<string> {
  const folder = join(root, 'index-repository');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'index.yaml'), text, 'utf8');
  await exec('git', ['init', '--quiet', '-b', 'main'], { cwd: folder });
  await exec('git', ['add', '.'], { cwd: folder });
  await exec('git', [...AUTHOR, 'commit', '--quiet', '-m', 'index'], { cwd: folder });
  return pathToFileURL(folder).href;
}

describe('fetchGalleryIndex', () => {
  it('reads index.yaml from the default branch, then the copy kept when the fetch fails', async () => {
    const url = await indexRepository('version: 1\nentries: []\n');
    const fetched = await fetchGalleryIndex(home, url);
    expect(fetched.diagnostics).toEqual([]);
    expect(fetched.text).toBe('version: 1\nentries: []\n');

    await rm(join(root, 'index-repository'), { recursive: true, force: true });
    const offline = await fetchGalleryIndex(home, url);
    expect(offline.text).toBe('version: 1\nentries: []\n');
    expect(offline.diagnostics.map((item) => item.code)).toEqual(['W_GALLERY_INDEX_OFFLINE']);
  });

  it('lists nothing, with an error, when the index was never fetched', async () => {
    const missing = pathToFileURL(join(root, 'nowhere')).href;
    const fetched = await fetchGalleryIndex(home, missing);
    expect(fetched.text).toBeUndefined();
    expect(fetched.diagnostics.map((item) => item.code)).toEqual(['E_GALLERY_INDEX_FETCH']);
  });
});

describe('the gallery record', () => {
  it('reads back what it wrote, and an unreadable record as empty', async () => {
    const directory = join(home, 'plugin-files');
    await writeGalleryRecord(directory, {
      tabela: [{ file: 'gallery.yaml', template: 'tabela', git: 'g', ref: 'v1' }],
      inbox: [{ file: 'inbox.yaml', git: 'h', ref: 'v2' }],
    });
    expect(await readGalleryRecord(directory)).toEqual({
      inbox: [{ file: 'inbox.yaml', git: 'h', ref: 'v2' }],
      tabela: [{ file: 'gallery.yaml', template: 'tabela', git: 'g', ref: 'v1' }],
    });
    expect(
      Object.keys(JSON.parse(await readFile(join(directory, GALLERY_RECORD_FILE), 'utf8')).entries),
    ).toEqual(['inbox', 'tabela']);

    await writeFile(join(directory, GALLERY_RECORD_FILE), '{ not json', 'utf8');
    expect(await readGalleryRecord(directory)).toEqual({});
  });
});
