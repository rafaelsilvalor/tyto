import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { type ConfigurationScope, type Diagnostic, configurationAlias } from '@tyto/core';
import {
  PLUGIN_MANIFEST_FILE,
  cachedCopy,
  fsPluginStore,
  locationOf,
  readPluginFolder,
} from '@tyto/io';
import {
  EMPTY_PLUGIN_FILES_LOCK,
  PLUGIN_API_VERSION,
  type PluginState,
  checkInstallable,
  configuredTemplates,
  folderSources,
  planPluginSync,
} from '@tyto/plugin-api';

import type { CliEnvironment } from './environment.js';
import {
  leftOutPluginFiles,
  machinePluginFiles,
  projectPluginFiles,
  workspaceOf,
} from './plugin-files.js';
import { displayPath } from './render.js';

/**
 * What the plugin files name, for `tyto plugin list` (TYTO-456).
 *
 * **Read, never fetched and never run**, as the rest of the listing is: the files, their lock,
 * the cached copy's manifest and the approvals in `plugins.json`. A source the cache lacks is
 * `not synced` rather than fetched, because a listing that reached the network would be a
 * sync with another name.
 *
 * The aliases are here and not in a `tyto template list` because they are written in these
 * files: listing them needs only what this reads. A list of every template a brief can name
 * would need the registry, which means starting every plugin's process to learn its
 * templates.
 */

/** Whether a render would load the copy, and if not, why not. */
export type PluginFileStatus = 'approved' | 'not approved' | 'not synced' | 'refused';

export interface ListedPluginFileSource {
  /** The plugin the lock says the commit holds; absent before the first sync. */
  readonly plugin?: string;
  readonly scope: ConfigurationScope;
  /** The first file that names the source, as messages name it. */
  readonly file: string;
  readonly git: string;
  readonly ref: string;
  /** The full locked commit; absent before the first sync. */
  readonly commit?: string;
  readonly status: PluginFileStatus;
}

export interface ListedAlias {
  readonly alias: string;
  readonly template: string;
  readonly configuration: string;
  readonly scope: ConfigurationScope;
  readonly file: string;
}

export interface ListedPluginFiles {
  readonly sources: readonly ListedPluginFileSource[];
  readonly aliases: readonly ListedAlias[];
  /** The line naming a restricted workspace's files as left out, or empty. */
  readonly leftOut: string;
  readonly diagnostics: readonly Diagnostic[];
}

export async function listPluginFiles(
  folder: string,
  home: string,
  environment: CliEnvironment,
): Promise<ListedPluginFiles> {
  const shown = (path: string): string => displayPath(environment.cwd, path);
  const workspace = await workspaceOf(resolve(environment.cwd, folder), environment);
  const stateRead = await fsPluginStore(home).readState();
  const state = stateRead.ok ? stateRead.value : { plugins: {} };
  const diagnostics: Diagnostic[] = stateRead.ok ? [] : [...stateRead.error];

  const folders: { readonly scope: ConfigurationScope; readonly directory: string }[] = [
    ...(workspace?.trusted === true
      ? [{ scope: 'project' as const, directory: projectPluginFiles(workspace.folder) }]
      : []),
    { scope: 'machine', directory: machinePluginFiles(home) },
  ];

  const sources: ListedPluginFileSource[] = [];
  const aliases: ListedAlias[] = [];
  for (const { scope, directory } of folders) {
    const read = await readPluginFolder(directory, shown);
    const named = folderSources(read.files);
    diagnostics.push(...read.diagnostics, ...named.diagnostics);
    // An unreadable lock pins nothing, and a sync refuses to load the folder until it is fixed.
    for (const step of planPluginSync(named.sources, read.lock ?? EMPTY_PLUGIN_FILES_LOCK, false)) {
      const { source, locked } = step;
      sources.push({
        ...(locked === undefined ? {} : { plugin: locked.plugin, commit: locked.commit }),
        scope,
        file: source.file,
        git: source.git,
        ref: source.ref,
        status:
          read.lock === undefined || locked === undefined
            ? 'not synced'
            : await statusOf(
                await cachedCopy(home, locationOf(source.git, directory), locked.commit),
                state,
              ),
      });
    }

    // A template the project configures takes none of the machine's configurations, as
    // `resolveTemplateConfigurations` decides.
    const projectTemplates = new Set(
      aliases.filter((alias) => alias.scope === 'project').map((alias) => alias.template),
    );
    for (const entry of configuredTemplates(read.files, directory)) {
      if (scope === 'machine' && projectTemplates.has(entry.template)) continue;
      for (const configuration of entry.configurations) {
        aliases.push({
          alias: configurationAlias(entry.template, configuration),
          template: entry.template,
          configuration: configuration.name,
          scope,
          file: entry.file,
        });
      }
    }
  }

  return {
    sources,
    aliases,
    leftOut: await leftOutPluginFiles(workspace, 'listed', environment),
    diagnostics,
  };
}

/** What a render would do with the cached copy: load it, refuse it, or skip it unapproved. */
async function statusOf(copy: string | undefined, state: PluginState): Promise<PluginFileStatus> {
  if (copy === undefined) return 'not synced';
  const manifestPath = join(copy, PLUGIN_MANIFEST_FILE);
  const checked = checkInstallable(
    await readFile(manifestPath, 'utf8').catch(() => ''),
    manifestPath,
    PLUGIN_API_VERSION,
  );
  if (!checked.ok) return 'refused';
  const approved = state.plugins[checked.value.name]?.permissions ?? [];
  return checked.value.permissions.every((permission) => approved.includes(permission))
    ? 'approved'
    : 'not approved';
}
