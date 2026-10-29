import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { hasErrors } from '@tyto/core';
import {
  NO_PLUGIN_FILES,
  type PluginFilesApproval,
  type SyncedPluginFiles,
  cleanPluginFilesCache,
  machinePluginFiles,
  projectPluginFiles,
  readPluginFolder,
  syncPluginFiles as syncPluginFolders,
} from '@tyto/io';
import { type PluginFilesLock } from '@tyto/plugin-api';

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
 * The sync itself is `@tyto/io`'s, the one the desktop runs too (TYTO-433). What this module
 * adds is the CLI's half: its built-in plugins, its paths as the shell shows them, and the
 * permission prompt at a terminal.
 */

export { NO_PLUGIN_FILES, type SyncedPluginFiles, machinePluginFiles, projectPluginFiles };

/**
 * The line that names a restricted workspace's plugin files as left out. ADR 0111: what a
 * restricted folder does not run is named, not hidden, and `sync`, `render` and `plugin list`
 * say it in the same words.
 */
export function leftOutNotice(
  workspace: string,
  what: 'fetched' | 'loaded' | 'listed',
  environment: CliEnvironment,
): string {
  return (
    `${displayPath(environment.cwd, projectPluginFiles(workspace))} was not ${what}: ` +
    'this folder is restricted, and a project’s plugins run only once it is trusted ' +
    '(tyto trust add).\n'
  );
}

/**
 * The same line, for a command that is not only about the plugin files: said only when the
 * restricted workspace has a plugin-files folder, so a render in a project with none stays
 * quiet. Empty when there is nothing to say.
 */
export async function leftOutPluginFiles(
  workspace: { readonly folder: string; readonly trusted: boolean } | undefined,
  what: 'loaded' | 'listed',
  environment: CliEnvironment,
): Promise<string> {
  if (workspace === undefined || workspace.trusted) return '';
  const found = await stat(projectPluginFiles(workspace.folder)).catch(() => undefined);
  return found?.isDirectory() === true ? leftOutNotice(workspace.folder, what, environment) : '';
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

export function syncPluginFiles(
  options: PluginFilesSyncOptions,
  environment: CliEnvironment,
): Promise<SyncedPluginFiles> {
  const shown = (path: string): string => displayPath(environment.cwd, path);
  return syncPluginFolders({
    home: options.home,
    ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
    update: options.update,
    fetches: options.fetches,
    builtInNames: new Set(builtInManifests().manifests.map((manifest) => manifest.name)),
    shown,
    onFileRead: (path, source, items) => {
      registerOrigin(items, { path: shown(path), source });
    },
    ...approvalOf(options.approval, environment),
  });
}

/** The answer `approval` gives: always yes, the prompt at a terminal, or nobody to ask. */
function approvalOf(
  approval: Approval,
  environment: CliEnvironment,
): { approve?: PluginFilesApproval } {
  // Approvals are recorded in the home's `plugins.json`; with no home there is nowhere to.
  if (environment.home === undefined) return {};
  if (approval === 'yes') return { approve: () => Promise.resolve(true) };
  const { confirm } = environment;
  if (approval === 'never' || confirm === undefined) return {};
  return {
    approve: async (manifest, source) => {
      environment.console.err(permissionPrompt(manifest, source));
      return confirm('Load it? [y/N] ');
    },
  };
}

/* -------------------------------------------------------------------------- commands -- */

export interface PluginSyncCommandOptions {
  readonly update: boolean;
  readonly yes: boolean;
}

/** The workspace `folder` is in, with its trust, as the sync and the cleanup read it. */
export async function workspaceOf(
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

export function homeOf(environment: CliEnvironment): string {
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
    environment.console.err(leftOutNotice(workspace.folder, 'fetched', environment));
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
