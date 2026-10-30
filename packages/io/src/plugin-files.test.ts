import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanPluginFilesCache, fetchToCache, syncPluginFolder } from './plugin-files.js';

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

/** Tags the repository's commit `v1` with an annotated tag; answers the tag object's id. */
async function annotatedTag(folder: string): Promise<string> {
  await exec('git', [...AUTHOR, '-C', folder, 'tag', '-a', 'v1', '-m', 'v1']);
  return (await exec('git', ['-C', folder, 'rev-parse', 'v1'])).stdout.trim();
}

/** Where the cache keeps the copies of `git`, as `plugin-files.ts` names it. */
function cacheOf(git: string): string {
  return join(home, 'cache', 'plugin-files', createHash('sha256').update(git).digest('hex'));
}

/**
 * What a version before TYTO-472 left for an annotated tag: a lock pinning the tag object's
 * id, and a copy cached under it with no record beside it.
 */
async function oldLockAndCopy(folder: string, git: string, tagObject: string): Promise<void> {
  await writeFile(
    join(folder, 'plugin-files.lock.json'),
    JSON.stringify({
      version: 1,
      sources: [{ git, ref: 'v1', commit: tagObject, plugin: 'fixture' }],
    }),
    'utf8',
  );
  await mkdir(join(cacheOf(git), tagObject), { recursive: true });
  await writeFile(join(cacheOf(git), tagObject, 'tyto-plugin.json'), MANIFEST, 'utf8');
}

async function lockedCommits(folder: string): Promise<string[]> {
  const lock = JSON.parse(await readFile(join(folder, 'plugin-files.lock.json'), 'utf8')) as {
    sources: { commit: string }[];
  };
  return lock.sources.map((entry) => entry.commit);
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
    // Nothing left staged beside the copy and the record that its name is a commit.
    expect((await readdir(join(directory, '..'))).sort()).toEqual([
      source.commit,
      `${source.commit}.commit`,
    ]);
  });

  it('takes an annotated tag to the commit it points at, not the tag object', async () => {
    const source = await repository();
    const tagObject = await annotatedTag(source.folder);
    expect(tagObject).not.toBe(source.commit);

    const fetched = await fetchToCache(home, source.url, 'v1');

    expect(fetched.ok && fetched.value.commit).toBe(source.commit);
    expect(fetched.ok && fetched.value.directory).toBe(join(cacheOf(source.url), source.commit));
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

    expect(synced).toEqual({ copies: [], files: [], diagnostics: [] });
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

  it('locks the commit an annotated tag points at', async () => {
    const source = await repository();
    await annotatedTag(source.folder);
    const folder = join(root, 'plugin-files');
    await pluginFile(folder, source.url, 'v1');

    const synced = await syncPluginFolder({
      home,
      directory: folder,
      shown,
      update: false,
      fetches: true,
    });

    expect(synced.diagnostics).toEqual([]);
    expect(synced.copies.map((copy) => copy.commit)).toEqual([source.commit]);
    expect(await lockedCommits(folder)).toEqual([source.commit]);
  });

  it("rewrites an old lock's tag object to its commit, without moving the ref", async () => {
    const source = await repository();
    const tagObject = await annotatedTag(source.folder);
    const folder = join(root, 'plugin-files');
    await pluginFile(folder, source.url, 'v1');
    await oldLockAndCopy(folder, source.url, tagObject);
    // Upstream moved on: a resolve of `v1` would now land on a second commit.
    await writeFile(join(source.folder, 'later.txt'), 'later', 'utf8');
    await exec('git', [...AUTHOR, '-C', source.folder, 'add', '.']);
    await exec('git', [...AUTHOR, '-C', source.folder, 'commit', '--quiet', '-m', 'two']);
    await exec('git', [...AUTHOR, '-C', source.folder, 'tag', '-a', '-f', 'v1', '-m', 'moved']);

    const synced = await syncPluginFolder({
      home,
      directory: folder,
      shown,
      update: false,
      fetches: true,
    });

    expect(synced.diagnostics).toEqual([]);
    expect(synced.copies.map((copy) => [copy.commit, copy.directory])).toEqual([
      [source.commit, join(cacheOf(source.url), source.commit)],
    ]);
    expect(await lockedCommits(folder)).toEqual([source.commit]);
  });

  it("loads an old lock's copy as before when the source cannot be reached", async () => {
    const source = await repository();
    const tagObject = await annotatedTag(source.folder);
    const folder = join(root, 'plugin-files');
    await pluginFile(folder, source.url, 'v1');
    await oldLockAndCopy(folder, source.url, tagObject);
    await rm(source.folder, { recursive: true, force: true });

    const synced = await syncPluginFolder({
      home,
      directory: folder,
      shown,
      update: false,
      fetches: true,
    });

    expect(synced.diagnostics).toEqual([]);
    expect(synced.copies.map((copy) => copy.commit)).toEqual([tagObject]);
    expect(await lockedCommits(folder)).toEqual([tagObject]);
  });

  it('fetches nothing for a pinned commit it has recorded', async () => {
    const source = await repository();
    const folder = join(root, 'plugin-files');
    await pluginFile(folder, source.url, 'main');
    const options = { home, directory: folder, shown, update: false, fetches: true };
    await syncPluginFolder(options);
    // Every fetch writes the record again, so a record left in 2000 is one nobody fetched.
    const record = join(cacheOf(source.url), `${source.commit}.commit`);
    const longAgo = new Date('2000-01-01T00:00:00Z');
    await utimes(record, longAgo, longAgo);

    const synced = await syncPluginFolder(options);

    expect(synced.diagnostics).toEqual([]);
    expect(synced.copies.map((copy) => copy.commit)).toEqual([source.commit]);
    expect((await stat(record)).mtime).toEqual(longAgo);
  });

  it("keeps a locked commit's record when cleaning, and drops a tag object's copy", async () => {
    const source = await repository();
    const tagObject = await annotatedTag(source.folder);
    const folder = join(root, 'plugin-files');
    await pluginFile(folder, source.url, 'v1');
    await oldLockAndCopy(folder, source.url, tagObject);
    await syncPluginFolder({ home, directory: folder, shown, update: false, fetches: true });

    const removed = await cleanPluginFilesCache(home, [
      {
        directory: folder,
        lock: {
          sources: [{ git: source.url, ref: 'v1', commit: source.commit, plugin: 'fixture' }],
        },
      },
    ]);

    expect(removed).toEqual([join(cacheOf(source.url), tagObject)]);
    expect((await readdir(cacheOf(source.url))).sort()).toEqual([
      source.commit,
      `${source.commit}.commit`,
    ]);
  });

  it('reports the copies it cleans, not their records', async () => {
    const source = await repository();
    await fetchToCache(home, source.url, 'main');

    const removed = await cleanPluginFilesCache(home, []);

    expect(removed).toEqual([join(cacheOf(source.url), source.commit)]);
    expect(await exists(cacheOf(source.url))).toBe(false);
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
