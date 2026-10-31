import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GALLERY_RECORD_FILE } from './gallery.js';
import {
  type Gallery,
  GALLERY_TEMPLATES_FILE,
  installGalleryEntry,
  readGallery,
  updateGalleryEntry,
} from './gallery-operations.js';

/**
 * The gallery's operations as data (TYTO-504): what install and update write and answer, with
 * no sync and no console. `tyto gallery`'s own tests run the same operations end to end, with
 * the sync and the lock; these pin the outcomes the window reads.
 *
 * The index is a `file://` repository made here; the templates it lists are never fetched,
 * because nothing here syncs, so their URLs need not exist.
 */

const exec = promisify(execFile);
// Every test fetches the index with `git` at least twice, which takes seconds on Windows.
vi.setConfig({ testTimeout: 60_000 });
const AUTHOR = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];
const shown = (path: string): string => path;

let root: string;
let home: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-gallery-operations-'));
  home = join(root, 'home');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const TABELA = 'https://git.example.invalid/tyto-template-tabela.git';
const AVISO = 'https://git.example.invalid/tyto-plugin-aviso.git';

function index(latest = 'v1', engine = '>=0.1.0'): string {
  return `version: 1
entries:
  - id: tabela
    kind: template
    name: Tabela
    description: A table.
    source: { git: '${TABELA}' }
    latest: ${latest}
    templates: [tabela]
    engine: '${engine}'
    changes: What ${latest} changes.
  - id: aviso
    kind: plugin
    name: Aviso
    description: A plugin.
    source: { git: '${AVISO}' }
    latest: v3
    engine: '>=0.1.0'
`;
}

/** The index repository at `text`; a second call commits the new text on top. */
async function indexRepository(text: string): Promise<string> {
  const folder = join(root, 'index');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'index.yaml'), text, 'utf8');
  const git = (...args: string[]) => exec('git', [...AUTHOR, '-C', folder, ...args]);
  await git('init', '--quiet', '--initial-branch=main');
  await git('add', '.');
  await git('commit', '--quiet', '--allow-empty', '-m', 'index');
  return pathToFileURL(folder).href;
}

async function galleryAt(text: string): Promise<Gallery> {
  const read = await readGallery(home, await indexRepository(text));
  if (read.gallery === undefined) throw new Error('no gallery');
  return read.gallery;
}

const machine = (name: string): string => join(home, 'plugin-files', name);

describe('readGallery', () => {
  it('reads each entry against the machine files, and lists nothing for an index never fetched', async () => {
    const gallery = await galleryAt(index());
    expect(gallery.statuses.map((status) => [status.entry.id, status.state])).toEqual([
      ['tabela', 'not installed'],
      ['aviso', 'not installed'],
    ]);

    const missing = await readGallery(home, pathToFileURL(join(root, 'nowhere')).href);
    expect(missing.gallery).toBeUndefined();
    expect(missing.fetched.diagnostics.map((item) => item.code)).toEqual(['E_GALLERY_INDEX_FETCH']);
  });

  it('keeps what reading the index said apart from the fetch', async () => {
    const read = await readGallery(home, await indexRepository('version: 2\nentries: []\n'));
    expect(read.gallery).toBeUndefined();
    expect(read.fetched.diagnostics).toEqual([]);
    expect(read.indexDiagnostics.map((item) => item.code)).toEqual(['E_GALLERY_INDEX_SYNTAX']);
  });
});

describe('installGalleryEntry', () => {
  it('writes a template pinned to latest, records it, and answers already installed after', async () => {
    const written = await installGalleryEntry(await galleryAt(index()), 'tabela', shown);
    expect(written).toMatchObject({ kind: 'written', path: machine(GALLERY_TEMPLATES_FILE) });
    expect(await readFile(machine(GALLERY_TEMPLATES_FILE), 'utf8')).toContain('ref: v1');
    expect(JSON.parse(await readFile(machine(GALLERY_RECORD_FILE), 'utf8'))).toEqual({
      version: 1,
      entries: { tabela: [{ file: 'gallery.yaml', template: 'tabela', git: TABELA, ref: 'v1' }] },
    });

    const again = await installGalleryEntry(await galleryAt(index()), 'tabela', shown);
    expect(again.kind).toBe('already installed');
  });

  it('writes a plugin as a file of its own, and refuses one whose file exists', async () => {
    const gallery = await galleryAt(index());
    expect(await installGalleryEntry(gallery, 'aviso', shown)).toMatchObject({
      kind: 'written',
      path: machine('aviso.yaml'),
    });

    await writeFile(machine('aviso.yaml'), '# mine\n', 'utf8');
    const refused = await installGalleryEntry(await galleryAt(index()), 'aviso', shown);
    expect(refused).toMatchObject({ kind: 'refused', problem: { code: 'E_GALLERY_WRITE' } });
    expect(await readFile(machine('aviso.yaml'), 'utf8')).toBe('# mine\n');
  });

  it('refuses an entry this Tyto cannot load, and one the index does not list, writing nothing', async () => {
    const gallery = await galleryAt(index('v1', '>=99.0.0'));
    expect(await installGalleryEntry(gallery, 'tabela', shown)).toMatchObject({
      kind: 'refused',
      problem: { code: 'E_GALLERY_ENGINE' },
    });
    expect(await installGalleryEntry(gallery, 'nada', shown)).toMatchObject({
      kind: 'refused',
      problem: { code: 'E_GALLERY_ENTRY_UNKNOWN' },
    });
    await expect(readFile(machine(GALLERY_TEMPLATES_FILE), 'utf8')).rejects.toThrow();
  });
});

describe('updateGalleryEntry', () => {
  it('waits for the call: a newer latest is shown, and only update moves the ref', async () => {
    await installGalleryEntry(await galleryAt(index('v1')), 'tabela', shown);
    const newer = await galleryAt(index('v2'));
    expect(newer.statuses[0]?.state).toBe('update available');
    expect(await readFile(machine(GALLERY_TEMPLATES_FILE), 'utf8')).toContain('ref: v1');

    const moved = await updateGalleryEntry(newer, 'tabela', shown);
    expect(moved).toMatchObject({ kind: 'moved', byHand: [], moved: [{ ref: 'v1' }] });
    expect(await readFile(machine(GALLERY_TEMPLATES_FILE), 'utf8')).toContain('ref: v2');
    expect((await updateGalleryEntry(await galleryAt(index('v2')), 'tabela', shown)).kind).toBe(
      'current',
    );
  });

  it('says a place written by hand before moving it', async () => {
    await mkdir(machine(''), { recursive: true });
    await writeFile(
      machine('mine.yaml'),
      `version: 1\ntemplates:\n  tabela:\n    source: { git: '${TABELA}', ref: v0 }\n`,
      'utf8',
    );
    const moved = await updateGalleryEntry(await galleryAt(index('v2')), 'tabela', shown);
    expect(moved).toMatchObject({ kind: 'moved', byHand: [{ file: machine('mine.yaml') }] });
    expect(await readFile(machine('mine.yaml'), 'utf8')).toContain('ref: v2');
  });

  it('refuses a ref changed by hand since the gallery wrote it, writing nothing, unless forced', async () => {
    await installGalleryEntry(await galleryAt(index('v1')), 'tabela', shown);
    const path = machine(GALLERY_TEMPLATES_FILE);
    await writeFile(path, (await readFile(path, 'utf8')).replace('ref: v1', 'ref: v1-mine'));
    const edited = await readFile(path, 'utf8');

    const refused = await updateGalleryEntry(await galleryAt(index('v2')), 'tabela', shown);
    expect(refused).toMatchObject({ kind: 'refused', problem: { code: 'E_GALLERY_ENTRY_EDITED' } });
    expect(await readFile(path, 'utf8')).toBe(edited);

    const forced = await updateGalleryEntry(await galleryAt(index('v2')), 'tabela', shown, {
      force: true,
    });
    expect(forced.kind).toBe('moved');
    expect(await readFile(path, 'utf8')).toContain('ref: v2');
  });

  it('refuses an entry no file holds', async () => {
    expect(await updateGalleryEntry(await galleryAt(index()), 'tabela', shown)).toMatchObject({
      kind: 'refused',
      problem: { code: 'E_GALLERY_NOT_INSTALLED' },
    });
  });
});
