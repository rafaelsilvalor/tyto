import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EMPTY_PLUGIN_STATE, withPluginEntry } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fsPluginStore } from './fs-plugin-store.js';

/** The store on a real temp disk: every claim here is about what ends up in a folder. */

let home: string;
let source: string;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'tyto-plugin-store-'));
  home = join(root, '.tyto');
  source = join(root, 'pdf');
  await mkdir(join(source, 'dist'), { recursive: true });
  await mkdir(join(source, '.git'), { recursive: true });
  await writeFile(join(source, 'tyto-plugin.json'), '{"name":"pdf"}');
  await writeFile(join(source, 'dist', 'index.js'), 'export function activate() {}');
  await writeFile(join(source, '.git', 'HEAD'), 'ref: refs/heads/main');
});

afterEach(async () => {
  await rm(join(home, '..'), { recursive: true, force: true });
});

describe('fsPluginStore', () => {
  it('answers an empty list and an empty state before anything was installed', async () => {
    const store = fsPluginStore(home);

    expect(await store.list()).toEqual([]);
    expect(await store.readState()).toEqual({
      ok: true,
      value: EMPTY_PLUGIN_STATE,
      diagnostics: [],
    });
  });

  it('copies a folder in under its name, leaving the git history behind', async () => {
    const store = fsPluginStore(home);
    await store.add('pdf', source);

    expect(await store.list()).toEqual([{ folder: 'pdf', manifestSource: '{"name":"pdf"}' }]);
    expect((await readdir(store.directoryOf('pdf'))).sort()).toEqual(['dist', 'tyto-plugin.json']);
  });

  it('replaces the previous files on a second add, rather than merging them', async () => {
    const store = fsPluginStore(home);
    await store.add('pdf', source);
    await writeFile(join(store.directoryOf('pdf'), 'stale.txt'), 'old');

    await store.add('pdf', source);

    expect(await readdir(store.directoryOf('pdf'))).not.toContain('stale.txt');
  });

  it('writes the state beside the plugins folder, so every entry of that folder is a plugin', async () => {
    const store = fsPluginStore(home);
    await store.add('pdf', source);
    await store.writeState(
      withPluginEntry(EMPTY_PLUGIN_STATE, 'pdf', { enabled: true, permissions: [], source }),
    );

    expect((await readdir(home)).sort()).toEqual(['plugins', 'plugins.json']);
    expect(JSON.parse(await readFile(join(home, 'plugins.json'), 'utf8'))).toEqual({
      plugins: { pdf: { enabled: true, permissions: [], source } },
    });
    expect((await store.list()).map((plugin) => plugin.folder)).toEqual(['pdf']);
  });

  it('does not list an install that was interrupted', async () => {
    const store = fsPluginStore(home);
    await mkdir(join(home, 'plugins', '.pdf.installing'), { recursive: true });

    expect(await store.list()).toEqual([]);
  });

  it('removes a plugin folder and nothing else', async () => {
    const store = fsPluginStore(home);
    await store.add('pdf', source);
    await store.remove('pdf');

    expect(await store.list()).toEqual([]);
  });

  it('reports a state file it cannot read as a diagnostic naming it', async () => {
    await mkdir(home, { recursive: true });
    await writeFile(join(home, 'plugins.json'), 'not json');

    const state = await fsPluginStore(home).readState();

    expect(!state.ok && state.error[0]?.code).toBe('E_PLUGIN_STATE');
  });
});
