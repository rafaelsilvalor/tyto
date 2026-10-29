import { join, resolve } from 'node:path';

import { type Diagnostic, type Diagnostics, diagnostic, hasErrors } from '@tyto/core';
import {
  PLUGIN_MANIFEST_FILE,
  type PluginFilesCopyOnDisk,
  cleanPluginFilesCache,
  fsPluginStore,
  readPluginFolder,
  syncPluginFolder,
} from '@tyto/io';
import {
  PLUGIN_API_VERSION,
  PLUGIN_FILES_DIRECTORY,
  type PluginFilesLock,
  checkInstallable,
  chooseCopies,
  withPluginEntry,
} from '@tyto/plugin-api';
import { readFile } from 'node:fs/promises';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import { builtInManifests, permissionPrompt } from './plugin.js';
import { displayPath } from './render.js';
import { formatDiagnostics, registerOrigin } from './report.js';
import { workspaceOfFolder } from './workspace.js';

/**
 * The plugin files, for the CLI (ADR 0151, TYTO-432).
 *
 * `tyto plugin sync` makes the cached copies match the machine's files, `TYTO_HOME/plugin-files/`,
 * and a workspace's, `.tyto/plugin-files/`, and writes each folder's lock; `--update` moves
 * every ref to where it is now. `tyto render` runs the same sync without `--update` and without
 * asking anything, so a render touches the network only for a copy the cache lacks, and never
 * moves a pinned ref. `tyto plugin clean` deletes the copies no lock names.
 *
 * A copy then loads as an installed plugin does: its own process, every check at every load,
 * and the approval in `TYTO_HOME/plugins.json` by name, never in a lock a project ships
 * (ADR 0151 decision 6).
 */

/** Where the machine's plugin files are. */
export function machinePluginFiles(home: string): string {
  return join(home, PLUGIN_FILES_DIRECTORY);
}

/** Where a workspace's plugin files are. */
export function projectPluginFiles(workspace: string): string {
  return join(workspace, '.tyto', PLUGIN_FILES_DIRECTORY);
}

/** Who answers when a fetched plugin asks for permissions nobody approved yet. */
export type Approval = 'yes' | 'ask' | 'never';

export interface PluginFilesSyncOptions {
  readonly home: string;
  /** The workspace whose files count. A restricted one's are neither fetched nor loaded. */
  readonly workspace?: { readonly folder: string; readonly trusted: boolean };
  readonly update: boolean;
  /** False for `tyto watch`, which only reads copies that already exist. */
  readonly fetches: boolean;
  readonly approval: Approval;
}

export interface SyncedPluginFiles {
  /** What loads, project before machine. */
  readonly copies: readonly PluginFilesCopyOnDisk[];
  readonly diagnostics: Diagnostics;
  /** Plugins left unapproved, which a render skips; for `sync`'s hint. */
  readonly unapproved: readonly string[];
}

export const NO_PLUGIN_FILES: SyncedPluginFiles = { copies: [], diagnostics: [], unapproved: [] };

export async function syncPluginFiles(
  options: PluginFilesSyncOptions,
  environment: CliEnvironment,
): Promise<SyncedPluginFiles> {
  const shown = (path: string): string => displayPath(environment.cwd, path);
  const folder = (directory: string) =>
    syncPluginFolder({
      home: options.home,
      directory,
      shown,
      update: options.update,
      fetches: options.fetches,
      onFileRead: (path, source, items) => registerOrigin(items, { path: shown(path), source }),
    });

  const project =
    options.workspace?.trusted === true
      ? await folder(projectPluginFiles(options.workspace.folder))
      : { copies: [], diagnostics: [] };
  const machine = await folder(machinePluginFiles(options.home));
  const chosen = chooseCopies(project.copies, machine.copies);
  const diagnostics: Diagnostic[] = [
    ...project.diagnostics,
    ...machine.diagnostics,
    ...chosen.diagnostics,
  ];

  // A built-in's name is never available, as `tyto plugin install` answers.
  const builtIns = new Set(builtInManifests().manifests.map((manifest) => manifest.name));
  const copies = chosen.copies.filter((copy) => {
    if (!builtIns.has(copy.plugin)) return true;
    diagnostics.push(
      diagnostic('E_PLUGIN_NAME_TAKEN', { plugin: copy.plugin, origin: 'built-in' }),
    );
    return false;
  });

  const store = fsPluginStore(options.home);
  const installed = new Set((await store.list()).map((plugin) => plugin.folder));
  for (const copy of copies) {
    if (installed.has(copy.plugin)) {
      diagnostics.push(
        diagnostic('W_PLUGIN_FILE_REPLACES_INSTALLED', { plugin: copy.plugin, file: copy.file }),
      );
    }
  }

  const unapproved = await approve(copies, options.approval, environment);
  return { copies, diagnostics, unapproved };
}

/**
 * Records the approval of each copy that needs one, in `plugins.json` by name.
 *
 * A plugin that asks for no permissions needs nobody's yes. One whose permissions were all
 * approved before loads without asking; one that asks for more asks again, which is what
 * reinstalling does. A state file nobody can read approves nothing, and the load says so.
 */
async function approve(
  copies: readonly PluginFilesCopyOnDisk[],
  approval: Approval,
  environment: CliEnvironment,
): Promise<string[]> {
  if (environment.home === undefined || copies.length === 0) return [];
  const store = fsPluginStore(environment.home);
  const read = await store.readState();
  if (!read.ok) return [];
  let state = read.value;
  const unapproved: string[] = [];

  for (const copy of copies) {
    const manifestPath = join(copy.directory, PLUGIN_MANIFEST_FILE);
    const checked = checkInstallable(
      await readFile(manifestPath, 'utf8').catch(() => ''),
      manifestPath,
      PLUGIN_API_VERSION,
    );
    // Refused at load, with the reason, like any installed folder.
    if (!checked.ok) continue;
    const manifest = checked.value;
    const entry = state.plugins[manifest.name];
    const missing = manifest.permissions.filter(
      (permission) => !(entry?.permissions.includes(permission) ?? false),
    );
    if (entry !== undefined && missing.length === 0) continue;

    let yes = missing.length === 0 || approval === 'yes';
    if (!yes && approval === 'ask' && environment.confirm !== undefined) {
      environment.console.err(permissionPrompt(manifest, `${copy.git} at ${copy.ref}`));
      yes = await environment.confirm('Load it? [y/N] ');
    }
    if (!yes) {
      unapproved.push(manifest.name);
      continue;
    }
    state = withPluginEntry(state, manifest.name, {
      enabled: entry?.enabled ?? true,
      permissions: manifest.permissions,
      source: copy.git,
    });
  }

  if (state !== read.value) await store.writeState(state);
  return unapproved;
}

/* -------------------------------------------------------------------------- commands -- */

export interface PluginSyncCommandOptions {
  readonly update: boolean;
  readonly yes: boolean;
}

/** The workspace `folder` is in, with its trust, as the sync and the cleanup read it. */
async function workspaceOf(
  folder: string,
  environment: CliEnvironment,
): Promise<{ readonly folder: string; readonly trusted: boolean } | undefined> {
  const found = await workspaceOfFolder(resolve(environment.cwd, folder), {}, environment, (path) =>
    displayPath(environment.cwd, path),
  );
  return found === undefined
    ? undefined
    : { folder: found.loaded.folder, trusted: found.loaded.trust === 'trusted' };
}

function homeOf(environment: CliEnvironment): string {
  if (environment.home === undefined) {
    throw new TypeError(
      'This environment names no home folder, so there are no plugin files to sync. ' +
        'defaultEnvironment() sets ~/.tyto.',
    );
  }
  return environment.home;
}

export async function pluginSyncCommand(
  folder: string,
  options: PluginSyncCommandOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const home = homeOf(environment);
  const workspace = await workspaceOf(folder, environment);
  if (workspace !== undefined && !workspace.trusted) {
    environment.console.err(
      `${displayPath(environment.cwd, projectPluginFiles(workspace.folder))} was not fetched: ` +
        'this folder is restricted, and a project’s plugins run only once it is trusted ' +
        '(tyto trust add).\n',
    );
  }
  const synced = await syncPluginFiles(
    {
      home,
      ...(workspace === undefined ? {} : { workspace }),
      update: options.update,
      fetches: true,
      approval: options.yes ? 'yes' : environment.confirm === undefined ? 'never' : 'ask',
    },
    environment,
  );

  for (const copy of synced.copies) {
    environment.console.out(
      `${copy.plugin}  ${copy.git}  ${copy.ref}  ${copy.commit.slice(0, 12)}  ${copy.file}\n`,
    );
  }
  if (synced.diagnostics.length > 0) environment.console.err(formatDiagnostics(synced.diagnostics));
  if (synced.unapproved.length > 0) {
    environment.console.err(
      `Not approved, so not loaded: ${synced.unapproved.join(', ')}. ` +
        'Run again at a terminal, or with --yes.\n',
    );
  }
  return hasErrors(synced.diagnostics) ? EXIT_DIAGNOSTICS : EXIT_OK;
}

export async function pluginCleanCommand(
  folder: string,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const home = homeOf(environment);
  const shown = (path: string): string => displayPath(environment.cwd, path);
  const workspace = await workspaceOf(folder, environment);
  const folders = [
    machinePluginFiles(home),
    ...(workspace === undefined ? [] : [projectPluginFiles(workspace.folder)]),
  ];

  const locks: { directory: string; lock: PluginFilesLock }[] = [];
  for (const directory of folders) {
    const read = await readPluginFolder(directory, shown);
    // A lock nobody can read could name anything: deleting under it would be a guess.
    if (read.lock === undefined) {
      environment.console.err(formatDiagnostics(read.diagnostics));
      return EXIT_DIAGNOSTICS;
    }
    locks.push({ directory, lock: read.lock });
  }
  const removed = await cleanPluginFilesCache(home, locks);
  for (const path of removed) environment.console.out(`${shown(path)}\n`);
  environment.console.err(
    `Removed ${removed.length} cached ${removed.length === 1 ? 'copy' : 'copies'}.\n`,
  );
  return EXIT_OK;
}
