import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fetchToCache, syncPluginFolder } from './plugin-files.js';

/**
 * The plugin files' disk half (ADR 0151 decision 3): `git` into the cache, and a folder's
 * lock. Every repository is a `file://` one made here with `git init`; the CLI's
 * `plugin-files.test.ts` takes the same path through `tyto plugin sync` and `tyto render`.
 */

const exec = promisify(execFile);
const AUTHOR = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];

let root: string;
let home: string;

const MANIFEST = JSON.stringify({
  name: 'fixture',
  version: '1.0.0',
  engine: '>=0.1.0',
  contributes: ['template-pack'],
  permissions: [],
});

/** A repository holding a plugin's manifest, one commit on `main`; answers its URL and commit. */
async function repository(): Promise<{ url: string; commit: string; folder: string }> {
  const folder = join(root, 'repository');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'tyto-plugin.json'), MANIFEST, 'utf8');
  await exec('git', ['init', '--quiet', '--initial-branch=main', folder]);
  await exec('git', [...AUTHOR, '-C', folder, 'add', '.']);
  await exec('git', [...AUTHOR, '-C', folder, 'commit', '--quiet', '-m', 'one']);
  const commit = (await exec('git', ['-C', folder, 'rev-parse', 'HEAD'])).stdout.trim();
  return { url: pathToFileURL(folder).href, commit, folder };
}

async function pluginFile(folder: string, git: string, ref: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, 'pack.yaml'),
    `version: 1\nplugin:\n  source: { git: '${git}', ref: '${ref}' }\n`,
    'utf8',
  );
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-plugin-files-io-'));
  home = join(root, 'home');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('fetching into the cache', () => {
  it.each(['main', 'commit'])('takes a %s, and keeps no history', async (kind) => {
    const source = await repository();

    const fetched = await fetchToCache(home, source.url, kind === 'main' ? 'main' : source.commit);

    expect(fetched.ok && fetched.value.commit).toBe(source.commit);
    const directory = fetched.ok ? fetched.value.directory : '';
    expect(await readdir(directory)).toEqual(['tyto-plugin.json']);
    // Nothing left staged beside the copy.
    expect(await readdir(join(directory, '..'))).toEqual([source.commit]);
  });

  it("answers git's first line when the source is not there", async () => {
    const fetched = await fetchToCache(home, pathToFileURL(join(root, 'nowhere')).href, 'main');

    expect(fetched.ok).toBe(false);
    expect(fetched.ok ? '' : fetched.error).not.toBe('');
  });
});

describe("a folder's sync", () => {
  const shown = (path: string): string => path;

  it('writes no lock into a folder that has no plugin files', async () => {
    const folder = join(root, 'plugin-files');
    await mkdir(folder);

    const synced = await syncPluginFolder({
      home,
      directory: folder,
      shown,
      update: false,
      fetches: true,
    });

    expect(synced).toEqual({ copies: [], diagnostics: [] });
    expect(await exists(join(folder, 'plugin-files.lock.json'))).toBe(false);
  });

  it('never fetches when told not to, and names the source it did not load', async () => {
    const source = await repository();
    const folder = join(root, 'plugin-files');
    await pluginFile(folder, source.url, 'main');

    const synced = await syncPluginFolder({
      home,
      directory: folder,
      shown,
      update: false,
      fetches: false,
    });

    expect(synced.copies).toEqual([]);
    expect(synced.diagnostics.map((item) => item.code)).toEqual(['W_PLUGIN_FILE_FETCH']);
    expect(await exists(join(home, 'cache'))).toBe(false);
  });

  it("reads a ../ source from the file's folder, and locks it as written", async () => {
    const source = await repository();
    const folder = join(root, 'plugin-files');
    await pluginFile(folder, '../repository', 'main');

    const synced = await syncPluginFolder({
      home,
      directory: folder,
      shown,
      update: false,
      fetches: true,
    });

    expect(synced.diagnostics).toEqual([]);
    expect(synced.copies.map((copy) => copy.commit)).toEqual([source.commit]);
    const lock = JSON.parse(await readFile(join(folder, 'plugin-files.lock.json'), 'utf8')) as {
      sources: { git: string }[];
    };
    expect(lock.sources.map((entry) => entry.git)).toEqual(['../repository']);
  });

  it('loads nothing from a folder whose lock cannot be read, and leaves the lock alone', async () => {
    const source = await repository();
    const folder = join(root, 'plugin-files');
    await pluginFile(folder, source.url, 'main');
    await writeFile(join(folder, 'plugin-files.lock.json'), '{ not json', 'utf8');

    const synced = await syncPluginFolder({
      home,
      directory: folder,
      shown,
      update: true,
      fetches: true,
    });

    expect(synced.copies).toEqual([]);
    expect(synced.diagnostics.map((item) => item.code)).toEqual(['E_PLUGIN_FILE_SYNTAX']);
    expect(await readFile(join(folder, 'plugin-files.lock.json'), 'utf8')).toBe('{ not json');
  });
});
