import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EMPTY_PLUGIN_CRASHES,
  EMPTY_PLUGIN_STATE,
  withPluginCrash,
  withPluginEntry,
} from '@tyto/plugin-api';
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

  // A junction on Windows, which needs no administrator; a symbolic link elsewhere. Both are
  // what a person's folder holds, and copying one as a link was an EPERM on Windows (TYTO-50).
  it('copies a link that lands inside the folder as what it points to', async () => {
    await mkdir(join(source, 'templates'), { recursive: true });
    await writeFile(join(source, 'templates', 'a.txt'), 'inside');
    await symlink(join(source, 'templates'), join(source, 'linked'), 'junction');
    const store = fsPluginStore(home);

    expect(await store.add('pdf', source)).toEqual({ ok: true, value: undefined, diagnostics: [] });

    const copied = join(store.directoryOf('pdf'), 'linked');
    expect((await lstat(copied)).isSymbolicLink()).toBe(false);
    expect(await readFile(join(copied, 'a.txt'), 'utf8')).toBe('inside');
  });

  it('refuses a link that leads out of the folder, naming it, and writes nothing', async () => {
    const outside = join(home, '..', 'outside');
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(source, 'dist', 'elsewhere'), 'junction');
    const store = fsPluginStore(home);

    const added = await store.add('pdf', source);

    expect(added.ok).toBe(false);
    if (added.ok) return;
    expect(added.error.map((problem) => [problem.code, problem.message])).toEqual([
      [
        'E_PLUGIN_LINK',
        `Plugin folder '${source}' holds '${join('dist', 'elsewhere')}', a link that leads out of the folder. A plugin may hold its own files only: replace the link with the file it points to.`,
      ],
    ]);
    expect(await store.list()).toEqual([]);
  });

  it('refuses a link that leads nowhere', async () => {
    const gone = join(home, '..', 'gone');
    await mkdir(gone, { recursive: true });
    await symlink(gone, join(source, 'dangling'), 'junction');
    await rm(gone, { recursive: true });
    const store = fsPluginStore(home);

    const added = await store.add('pdf', source);

    expect(added.ok ? [] : added.error.map((problem) => problem.message)).toEqual([
      expect.stringContaining("holds 'dangling', a link that leads nowhere."),
    ]);
  });

  it('names a link made in an installed folder after install, which a load refuses (ADR 0049)', async () => {
    const store = fsPluginStore(home);
    await store.add('pdf', source);
    expect(await store.linksLeaving('pdf')).toEqual([]);

    const outside = join(home, '..', 'outside');
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(store.directoryOf('pdf'), 'dist', 'later'), 'junction');

    expect((await store.linksLeaving('pdf')).map((problem) => problem.code)).toEqual([
      'E_PLUGIN_LINK',
    ]);
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

  it('keeps crash history in a file of its own, beside the state and apart from it', async () => {
    const store = fsPluginStore(home);
    expect(await store.readCrashes()).toEqual({
      ok: true,
      value: EMPTY_PLUGIN_CRASHES,
      diagnostics: [],
    });

    const crash = { at: '2026-09-27T12:00:00.000Z', reason: 'its thread exited with code 7' };
    await store.writeCrashes(withPluginCrash(EMPTY_PLUGIN_CRASHES, 'pdf', crash));

    expect((await readdir(home)).sort()).toEqual(['crashes.json']);
    const read = await store.readCrashes();
    expect(read.ok && read.value.crashes).toEqual({ pdf: crash });
  });
});
