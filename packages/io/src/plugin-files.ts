import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { type Diagnostic, type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';
import {
  EMPTY_PLUGIN_FILES_LOCK,
  PLUGIN_API_VERSION,
  PLUGIN_FILES_LOCK_FILE,
  PLUGIN_FILE_EXTENSION,
  type PluginFile,
  type PluginFilesCopy,
  type PluginFilesLock,
  type PluginFilesLockEntry,
  type PluginStore,
  type StoredPlugin,
  checkInstallable,
  folderSources,
  parsePluginFile,
  parsePluginFilesLock,
  planPluginSync,
  serializePluginFilesLock,
} from '@tyto/plugin-api';

import {
  PLUGIN_MANIFEST_FILE,
  fsPluginStore,
  linksOutside,
  readIfPresent,
  writeAtomically,
} from './fs-plugin-store.js';

/**
 * Plugin files on a disk: reading a folder, fetching with `git`, the lock and the cache
 * (ADR 0151 decision 3). What the files and the lock *mean* is `@tyto/plugin-api`'s; this
 * module is where they meet a filesystem and the person's `git`.
 *
 * ```
 * <folder>/                         TYTO_HOME/plugin-files/ or <workspace>/.tyto/plugin-files/
 *   *.yaml                          the plugin files
 *   plugin-files.lock.json          the commit each source resolved to; the tool writes it
 * TYTO_HOME/cache/plugin-files/<sha256(git)>/<commit>/   one copy per commit, without .git
 * ```
 *
 * **The network is `git`'s** (ADR 0011, ADR 0127): the person's own configuration, credential
 * helper, SSH keys and proxy. Tyto stores and asks for nothing. A sync runs unattended, so
 * `git` runs with `GIT_TERMINAL_PROMPT=0` and a missing credential fails instead of waiting on
 * a prompt nobody sees (ADR 0151 decision 5). Nothing a fetched repository ships is run here:
 * it is a plugin folder, loaded as an installed one is.
 */

const run = promisify(execFile);

/** `TYTO_HOME/cache/plugin-files/`. */
export const PLUGIN_FILES_CACHE = join('cache', 'plugin-files');

/** A copy a sync left on disk, and the folder it is in. */
export interface PluginFilesCopyOnDisk extends PluginFilesCopy {
  readonly directory: string;
}

/**
 * Told each file's text and what it said, so a caller can place a diagnostic's range in the
 * file it points into rather than in whatever document it is printing.
 */
export type FileReadListener = (path: string, text: string, diagnostics: Diagnostics) => void;

export interface PluginFolderRead {
  readonly files: readonly PluginFile[];
  /** Absent when the lock exists and could not be read: nothing in the folder loads then. */
  readonly lock?: PluginFilesLock;
  /** Whether a lock file is on disk, so an empty one is not written into a folder with none. */
  readonly lockExists: boolean;
  readonly diagnostics: Diagnostics;
}

/**
 * Every `*.yaml` in `directory`, in name order, and its lock. A folder that is not there
 * holds nothing, which is the common case: most machines have no plugin files.
 *
 * `shown` turns a path into the name messages carry.
 */
export async function readPluginFolder(
  directory: string,
  shown: (path: string) => string,
  onFileRead?: FileReadListener,
): Promise<PluginFolderRead> {
  let names: string[];
  try {
    names = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(PLUGIN_FILE_EXTENSION))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return { files: [], lock: EMPTY_PLUGIN_FILES_LOCK, lockExists: false, diagnostics: [] };
    }
    throw cause;
  }

  const diagnostics: Diagnostic[] = [];
  const files: PluginFile[] = [];
  for (const name of names) {
    const path = join(directory, name);
    const text = await readFile(path, 'utf8');
    const read = parsePluginFile(text, shown(path));
    onFileRead?.(path, text, read.diagnostics);
    diagnostics.push(...read.diagnostics);
    if (read.value !== undefined) files.push(read.value);
  }

  const lockPath = join(directory, PLUGIN_FILES_LOCK_FILE);
  const lockSource = await readIfPresent(lockPath);
  if (lockSource === undefined) {
    return { files, lock: EMPTY_PLUGIN_FILES_LOCK, lockExists: false, diagnostics };
  }
  const lock = parsePluginFilesLock(lockSource, shown(lockPath));
  if (!lock.ok) return { files, lockExists: true, diagnostics: [...diagnostics, ...lock.error] };
  return { files, lock: lock.value, lockExists: true, diagnostics };
}

/**
 * Where `git` reaches a source written in a file in `directory`. A path that starts with
 * `./` or `../` is relative to the file's folder, as an image path is (ADR 0151 decision 2);
 * anything else is handed to `git` as written. The lock keeps it as written, so a project's
 * lock means the same thing wherever the project is checked out.
 */
export function locationOf(git: string, directory: string): string {
  return /^\.\.?[\\/]/u.test(git) ? resolve(directory, git) : git;
}

function sourceFolder(home: string, git: string): string {
  return join(home, PLUGIN_FILES_CACHE, createHash('sha256').update(git).digest('hex'));
}

/** The cached copy of `commit` from `git`, when one is on disk. */
export async function cachedCopy(
  home: string,
  git: string,
  commit: string,
): Promise<string | undefined> {
  const directory = join(sourceFolder(home, git), commit);
  try {
    return (await stat(directory)).isDirectory() ? directory : undefined;
  } catch {
    return undefined;
  }
}

function problemOf(cause: unknown): string {
  const stderr = (cause as { readonly stderr?: unknown } | undefined)?.stderr;
  if (typeof stderr === 'string' && stderr.trim() !== '') {
    return stderr.trim().split('\n')[0]?.trim() ?? '';
  }
  return cause instanceof Error ? (cause.message.split('\n')[0] ?? cause.message) : String(cause);
}

async function git(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await run('git', [...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout;
}

/**
 * Fetches `want` — a tag, a branch or a full commit — from `url` into the cache.
 *
 * `git init` and `git fetch --depth 1`, not `git clone --branch`, because a fetch takes a
 * commit hash as well as a ref name. The copy is staged beside its name and renamed into
 * place (ADR 0117 point 4), so a fetch that dies halfway leaves no copy rather than half of
 * one; a commit already cached is kept as it is.
 */
export async function fetchToCache(
  home: string,
  url: string,
  want: string,
): Promise<Result<{ readonly commit: string; readonly directory: string }, string>> {
  const root = sourceFolder(home, url);
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(join(root, '.fetching-'));
  try {
    await git(['init', '--quiet'], staging);
    await git(['fetch', '--depth', '1', '--quiet', url, want], staging);
    const commit = (await git(['rev-parse', 'FETCH_HEAD'], staging)).trim();
    // The commit's bytes as committed: a person's `core.autocrlf` would otherwise give two
    // machines that lock one commit two different copies of it.
    await git(
      [
        '-c',
        'advice.detachedHead=false',
        '-c',
        'core.autocrlf=false',
        '-c',
        'core.eol=lf',
        'checkout',
        '--quiet',
        'FETCH_HEAD',
      ],
      staging,
    );
    await rm(join(staging, '.git'), { recursive: true, force: true });

    const directory = join(root, commit);
    if ((await cachedCopy(home, url, commit)) === undefined) {
      await rename(staging, directory);
    }
    return ok({ commit, directory });
  } catch (cause) {
    return err(problemOf(cause));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** The plugin a copy holds, by its manifest, or why it is not one this Tyto can load. */
async function pluginOf(directory: string): Promise<Result<string, string>> {
  const manifestPath = join(directory, PLUGIN_MANIFEST_FILE);
  const source = await readIfPresent(manifestPath);
  if (source === undefined) return err(`it has no ${PLUGIN_MANIFEST_FILE}`);
  const checked = checkInstallable(source, manifestPath, PLUGIN_API_VERSION);
  return checked.ok
    ? ok(checked.value.name)
    : err(checked.error.map((item) => item.message).join(' '));
}

export interface SyncPluginFolderOptions {
  readonly home: string;
  readonly directory: string;
  readonly shown: (path: string) => string;
  /** The explicit update: every ref is asked again, and the lock moves to where it is now. */
  readonly update: boolean;
  /**
   * False for `tyto watch`, which never fetches (ADR 0151 decision 3): it loads the copies the
   * lock names that are already cached, and writes no lock.
   */
  readonly fetches: boolean;
  readonly onFileRead?: FileReadListener;
}

export interface SyncedFolder {
  readonly copies: readonly PluginFilesCopyOnDisk[];
  readonly diagnostics: Diagnostics;
}

/**
 * Makes one folder's copies match its files and its lock, and answers what loads.
 *
 * A pinned source is fetched only when the cache lacks its commit, and never moves; a source
 * the lock lacks, or every source on the update, is resolved and the lock written. A commit
 * that is not a plugin this Tyto can load is refused before the lock moves to it. A fetch that
 * fails loads the locked copy when there is one, and says so either way (ADR 0151 decision 4).
 */
export async function syncPluginFolder(options: SyncPluginFolderOptions): Promise<SyncedFolder> {
  const { home, directory, shown } = options;
  const read = await readPluginFolder(directory, shown, options.onFileRead);
  const diagnostics: Diagnostic[] = [...read.diagnostics];
  // A lock nobody can read pins nothing anybody can trust; resolving instead would move every
  // ref without a word, so the folder loads nothing until the lock is fixed or deleted.
  if (read.lock === undefined) return { copies: [], diagnostics };

  const named = folderSources(read.files);
  diagnostics.push(...named.diagnostics);

  const copies: PluginFilesCopyOnDisk[] = [];
  const lock: PluginFilesLockEntry[] = [];
  const failed = (step: { git: string; ref: string }, problem: string, kept?: string): void => {
    diagnostics.push(
      diagnostic('W_PLUGIN_FILE_FETCH', {
        git: step.git,
        ref: step.ref,
        problem,
        outcome:
          kept === undefined
            ? 'Nothing from it loads.'
            : `The copy of commit ${kept} fetched earlier loads.`,
      }),
    );
  };

  for (const step of planPluginSync(named.sources, read.lock, options.update)) {
    const { source, locked } = step;
    const location = locationOf(source.git, directory);
    const copyOf = (entry: PluginFilesLockEntry, at: string): PluginFilesCopyOnDisk => ({
      plugin: entry.plugin,
      file: source.file,
      git: source.git,
      ref: source.ref,
      commit: entry.commit,
      templates: source.templates,
      wholePlugin: source.wholePlugin,
      directory: at,
    });
    const lockedCopy =
      locked === undefined ? undefined : await cachedCopy(home, location, locked.commit);
    const keepLocked = (): void => {
      if (locked === undefined) return;
      lock.push(locked);
      if (lockedCopy !== undefined) copies.push(copyOf(locked, lockedCopy));
    };

    if (!options.fetches) {
      if (locked === undefined || lockedCopy === undefined) {
        failed(
          source,
          'it has not been fetched yet, and tyto watch never fetches; run tyto plugin sync',
        );
      }
      keepLocked();
      continue;
    }

    if (!step.resolve && locked !== undefined) {
      if (lockedCopy !== undefined) {
        keepLocked();
        continue;
      }
      const fetched = await fetchToCache(home, location, locked.commit);
      lock.push(locked);
      if (fetched.ok) copies.push(copyOf(locked, fetched.value.directory));
      else failed(source, fetched.error);
      continue;
    }

    const fetched = await fetchToCache(home, location, source.ref);
    if (!fetched.ok) {
      failed(source, fetched.error, lockedCopy === undefined ? undefined : locked?.commit);
      keepLocked();
      continue;
    }
    const plugin = await pluginOf(fetched.value.directory);
    if (!plugin.ok) {
      diagnostics.push(
        diagnostic('E_PLUGIN_FILE_SOURCE_REFUSED', {
          git: source.git,
          ref: source.ref,
          commit: fetched.value.commit,
          problem: plugin.error,
          outcome:
            locked === undefined
              ? 'Nothing from it loads.'
              : `The lock keeps commit ${locked.commit}.`,
        }),
      );
      keepLocked();
      continue;
    }
    const entry = {
      git: source.git,
      ref: source.ref,
      commit: fetched.value.commit,
      plugin: plugin.value,
    };
    lock.push(entry);
    copies.push(copyOf(entry, fetched.value.directory));
  }

  // Only what the files still name: a source removed from them leaves the lock with it. Its
  // copy stays in the cache until `tyto plugin clean`.
  const next = serializePluginFilesLock({ sources: lock });
  if (read.lockExists || lock.length > 0) {
    const lockPath = join(directory, PLUGIN_FILES_LOCK_FILE);
    if ((await readIfPresent(lockPath)) !== next) await writeAtomically(lockPath, next);
  }
  return { copies, diagnostics };
}

/**
 * Deletes every cached copy no lock in `locks` names, and answers the folders it deleted.
 *
 * Only the locks the caller can see count, so a project nobody named loses its copies; the
 * next sync there fetches them again (ADR 0151 decision 3).
 */
export async function cleanPluginFilesCache(
  home: string,
  locks: readonly { readonly directory: string; readonly lock: PluginFilesLock }[],
): Promise<string[]> {
  const keep = new Set(
    locks.flatMap(({ directory, lock }) =>
      lock.sources.map((entry) =>
        join(sourceFolder(home, locationOf(entry.git, directory)), entry.commit),
      ),
    ),
  );
  const cache = join(home, PLUGIN_FILES_CACHE);
  let sources: string[];
  try {
    sources = await readdir(cache);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const source of sources) {
    const folder = join(cache, source);
    let commits: string[];
    try {
      commits = await readdir(folder);
    } catch {
      continue;
    }
    for (const commit of commits) {
      const path = join(folder, commit);
      if (keep.has(path)) continue;
      await rm(path, { recursive: true, force: true });
      removed.push(path);
    }
    if ((await readdir(folder)).length === 0) await rm(folder, { recursive: true, force: true });
  }
  return removed;
}

/**
 * The installed plugins' store with the plugin files' copies in front (ADR 0151 decision 6).
 *
 * A copy is listed under its plugin's name and found in the cache; approvals and crashes are
 * `TYTO_HOME`'s, by name, as an installed plugin's are. A plugin installed with
 * `tyto plugin install` under a name a copy has is left out: the file's wins.
 */
export function pluginStoreWithCopies(
  home: string,
  copies: readonly PluginFilesCopyOnDisk[],
): PluginStore {
  const installed = fsPluginStore(home);
  const byName = new Map(copies.map((copy) => [copy.plugin, copy.directory]));
  return {
    ...installed,
    async list(): Promise<readonly StoredPlugin[]> {
      const fetched = await Promise.all(
        [...byName].map(async ([folder, directory]) => ({
          folder,
          manifestSource: await readIfPresent(join(directory, PLUGIN_MANIFEST_FILE)),
        })),
      );
      const rest = (await installed.list()).filter((plugin) => !byName.has(plugin.folder));
      return [...fetched, ...rest];
    },
    directoryOf: (name) => byName.get(name) ?? installed.directoryOf(name),
    linksLeaving: (name) => {
      const directory = byName.get(name);
      return directory === undefined ? installed.linksLeaving(name) : linksOutside(directory);
    },
  };
}
