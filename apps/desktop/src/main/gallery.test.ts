import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/ipc.js';
import { PREVIEW_LIMIT_BYTES, createDesktopGallery, previewUrl } from './gallery.js';

/**
 * The window's gallery in main (TYTO-504): `@tyto/io`'s operations against a real index and
 * real plugin files, with the sync counted rather than run. What the window draws from the
 * answers is `src/renderer/gallery-view.test.ts`'s; installing into the running window is
 * `e2e/gallery.desktop.test.ts`'s.
 *
 * The index is a `file://` repository made here; the templates it lists are never fetched,
 * because the sync is a counter, so their URLs need not exist.
 */

const exec = promisify(execFile);
const AUTHOR = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];
// Every test fetches the index with `git`, which takes seconds on a loaded Windows machine.
vi.setConfig({ testTimeout: 60_000 });

const TABELA = 'https://git.example.invalid/tyto-template-tabela.git';
const PICTURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

let root: string;
let home: string;
let index: string;
let syncs: number;

function text(latest: string): string {
  return `version: 1
entries:
  - id: tabela
    kind: template
    name: Tabela
    description: A table.
    source: { git: '${TABELA}' }
    latest: ${latest}
    templates: [tabela]
    engine: '>=0.1.0'
    preview: previews/tabela.png
    changes: What ${latest} changes.
`;
}

async function publish(latest: string): Promise<void> {
  const folder = join(root, 'index');
  await mkdir(join(folder, 'previews'), { recursive: true });
  await writeFile(join(folder, 'previews', 'tabela.png'), PICTURE);
  await writeFile(join(folder, 'index.yaml'), text(latest), 'utf8');
  const git = (...args: string[]) => exec('git', [...AUTHOR, '-C', folder, ...args]);
  await git('init', '--quiet', '--initial-branch=main');
  await git('add', '.');
  await git('commit', '--quiet', '--allow-empty', '-m', latest);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-desktop-gallery-'));
  home = join(root, 'home');
  index = pathToFileURL(join(root, 'index')).href;
  syncs = 0;
  await publish('v1');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function gallery(at = (): string => index) {
  return createDesktopGallery({
    home,
    index: at,
    sync: () => {
      syncs += 1;
      return Promise.resolve();
    },
  });
}

const machineFile = (): string => join(home, 'plugin-files', 'gallery.yaml');

describe('the window gallery', () => {
  it('lists without writing or syncing, with the preview as a data URL', async () => {
    const view = await gallery().list();
    expect(view.entries?.map((entry) => [entry.id, entry.state, entry.latest])).toEqual([
      ['tabela', 'not installed', 'v1'],
    ]);
    expect(view.entries?.[0]?.preview).toBe(`data:image/png;base64,${PICTURE.toString('base64')}`);
    expect(view.cached).toBeUndefined();
    expect(syncs).toBe(0);
    await expect(readFile(machineFile(), 'utf8')).rejects.toThrow();
    expect(IPC_CHANNELS['gallery:list'].response.safeParse(view).success).toBe(true);
  });

  it('installs pinned to latest, syncs once, and answers the gallery read again', async () => {
    const done = await gallery().install('tabela');
    expect(done.outcome).toBe('written');
    expect(syncs).toBe(1);
    expect(await readFile(machineFile(), 'utf8')).toContain('ref: v1');
    expect(done.view.entries?.[0]?.state).toBe('installed');
    expect(IPC_CHANNELS['gallery:install'].response.safeParse(done).success).toBe(true);

    const again = await gallery().install('tabela');
    expect(again.outcome).toBe('already installed');
    expect(syncs).toBe(1);
  });

  it('shows a newer tag and waits: only update moves the ref, then syncs', async () => {
    await gallery().install('tabela');
    await publish('v2');

    const listed = await gallery().list();
    expect(listed.entries?.[0]).toMatchObject({
      state: 'update available',
      pinned: ['v1'],
      latest: 'v2',
      changes: 'What v2 changes.',
    });
    expect(await readFile(machineFile(), 'utf8')).toContain('ref: v1');
    expect(syncs).toBe(1);

    const moved = await gallery().update('tabela');
    expect(moved.outcome).toBe('moved');
    expect(syncs).toBe(2);
    expect(await readFile(machineFile(), 'utf8')).toContain('ref: v2');
    expect(moved.view.entries?.[0]?.state).toBe('installed');
  });

  it('refuses a ref changed by hand, writing and syncing nothing, and offers no force', async () => {
    await gallery().install('tabela');
    await publish('v2');
    const edited = (await readFile(machineFile(), 'utf8')).replace('ref: v1', 'ref: mine');
    await writeFile(machineFile(), edited, 'utf8');

    const refused = await gallery().update('tabela');
    expect(refused.outcome).toBe('refused');
    expect(refused.problem).toMatch(/^E_GALLERY_ENTRY_EDITED: /u);
    expect(await readFile(machineFile(), 'utf8')).toBe(edited);
    expect(syncs).toBe(1);
  });

  it('says the list is cached when the fetch fails, and refuses to act on no index', async () => {
    await gallery().list();
    await rm(join(root, 'index'), { recursive: true, force: true });
    const offline = await gallery().list();
    expect(offline.cached).toBeDefined();
    expect(offline.entries?.[0]?.preview).toBeDefined();
    expect(offline.problems[0]).toMatch(/^W_GALLERY_INDEX_OFFLINE: /u);

    const nowhere = pathToFileURL(join(root, 'nowhere')).href;
    const refused = await gallery(() => nowhere).install('tabela');
    expect(refused.outcome).toBe('refused');
    expect(refused.problem).toMatch(/^E_GALLERY_INDEX_FETCH: /u);
    expect(syncs).toBe(0);
  });

  it('reads the setting on every request', async () => {
    let at = pathToFileURL(join(root, 'nowhere')).href;
    const live = gallery(() => at);
    expect((await live.list()).entries).toBeUndefined();
    at = index;
    expect((await live.list()).entries).toHaveLength(1);
  });
});

describe('previewUrl', () => {
  it('shows a picture of a known type within the limit, and nothing else', async () => {
    const small = join(root, 'a.PNG');
    await writeFile(small, PICTURE);
    expect(await previewUrl(small)).toMatch(/^data:image\/png;base64,/u);

    const script = join(root, 'a.svg');
    await writeFile(script, '<svg/>');
    expect(await previewUrl(script)).toBeUndefined();

    const large = join(root, 'b.png');
    await writeFile(large, Buffer.alloc(PREVIEW_LIMIT_BYTES + 1));
    expect(await previewUrl(large)).toBeUndefined();
    expect(await previewUrl(join(root, 'missing.png'))).toBeUndefined();
  });
});
