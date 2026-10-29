import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type ConfigurationImageResolver,
  type ConfiguredTemplate,
  type Diagnostic,
  type Diagnostics,
  diagnostic,
} from '@tyto/core';
import {
  PLUGIN_API_VERSION,
  PLUGIN_FILES_DIRECTORY,
  type PluginManifest,
  checkInstallable,
  chooseCopies,
  configuredTemplates,
  withPluginEntry,
} from '@tyto/plugin-api';

import { PLUGIN_MANIFEST_FILE, fsPluginStore } from './fs-plugin-store.js';
import { pluginFileImages } from './plugin-file-images.js';
import {
  type FileReadListener,
  type PluginFilesCopyOnDisk,
  type SourceProblemListener,
  syncPluginFolder,
} from './plugin-files.js';

/**
 * The plugin files' sync, as every app runs it (ADR 0151, TYTO-432, TYTO-433).
 *
 * Both folders, project before machine: the machine's `TYTO_HOME/plugin-files/` and a
 * workspace's `.tyto/plugin-files/`, each made to match its lock. A restricted workspace's are
 * neither fetched nor loaded. What only an app knows is a parameter: the built-in plugins'
 * names, how a path is shown, and who answers when a fetched plugin asks for permissions.
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

/**
 * Asked about a fetched plugin whose permissions nobody approved yet; `source` names its
 * repository and ref. Yes records the approval.
 */
export type PluginFilesApproval = (manifest: PluginManifest, source: string) => Promise<boolean>;

export interface PluginFilesSyncOptions {
  readonly home: string;
  /** The workspace whose files count. A restricted one's are neither fetched nor loaded. */
  readonly workspace?: { readonly folder: string; readonly trusted: boolean };
  readonly update: boolean;
  /** False for `tyto watch`, which only reads copies that already exist. */
  readonly fetches: boolean;
  /** A built-in's name is never available, as `tyto plugin install` answers. */
  readonly builtInNames: ReadonlySet<string>;
  readonly shown: (path: string) => string;
  /** Told each file's text, besides the `texts` the answer carries. */
  readonly onFileRead?: FileReadListener;
  /** Told the file a source's range-less diagnostics are about (a failed fetch, a refusal). */
  readonly onSourceProblem?: SourceProblemListener;
  /** Absent: nobody is asked, and a plugin that needs a yes is left unapproved. */
  readonly approve?: PluginFilesApproval;
}

export interface SyncedPluginFiles {
  /** What loads, project before machine. */
  readonly copies: readonly PluginFilesCopyOnDisk[];
  /** The templates each folder's files configure, for `resolveTemplateConfigurations`. */
  readonly configured: {
    readonly project: readonly ConfiguredTemplate[];
    readonly machine: readonly ConfiguredTemplate[];
  };
  /** Reads the images the configurations name, each inside the folder it may read. */
  readonly images: ConfigurationImageResolver;
  /** Each file's text by the name messages carry, to place a range in the file it is in. */
  readonly texts: ReadonlyMap<string, string>;
  readonly diagnostics: Diagnostics;
  /** Plugins left unapproved, which a load skips; for a hint. */
  readonly unapproved: readonly string[];
}

export const NO_PLUGIN_FILES: SyncedPluginFiles = {
  copies: [],
  configured: { project: [], machine: [] },
  images: () => Promise.resolve({ problem: 'has no folder it may be read from' }),
  texts: new Map(),
  diagnostics: [],
  unapproved: [],
};

/**
 * Each entry with the plugin that fetched its template, so its configurations reach that
 * template and not one another source wins the name with (TYTO-462).
 *
 * Every entry names a source (`source is required`), and once copies are chosen a template a
 * file names is listed by at most one copy. An entry no copy lists was not fetched, by a
 * fetch that failed or a name refused, and is left out: it configures nothing, as a template
 * that did not load configures nothing, and the fetch has said why on its own.
 */
function fetchedBy(
  entries: readonly ConfiguredTemplate[],
  copies: readonly PluginFilesCopyOnDisk[],
): ConfiguredTemplate[] {
  return entries.flatMap((entry) => {
    const copy = copies.find((item) => item.templates.includes(entry.template));
    return copy === undefined ? [] : [{ ...entry, plugin: copy.plugin }];
  });
}

export async function syncPluginFiles(options: PluginFilesSyncOptions): Promise<SyncedPluginFiles> {
  const { shown } = options;
  const texts = new Map<string, string>();
  const folder = (directory: string) =>
    syncPluginFolder({
      home: options.home,
      directory,
      shown,
      update: options.update,
      fetches: options.fetches,
      onFileRead: (path, source, items) => {
        texts.set(shown(path), source);
        options.onFileRead?.(path, source, items);
      },
      ...(options.onSourceProblem === undefined
        ? {}
        : { onSourceProblem: options.onSourceProblem }),
    });

  const projectDirectory =
    options.workspace?.trusted === true ? projectPluginFiles(options.workspace.folder) : undefined;
  const project =
    projectDirectory === undefined
      ? { copies: [], files: [], diagnostics: [] }
      : await folder(projectDirectory);
  const machineDirectory = machinePluginFiles(options.home);
  const machine = await folder(machineDirectory);
  const chosen = chooseCopies(project.copies, machine.copies);
  const diagnostics: Diagnostic[] = [
    ...project.diagnostics,
    ...machine.diagnostics,
    ...chosen.diagnostics,
  ];

  const copies = chosen.copies.filter((copy) => {
    if (!options.builtInNames.has(copy.plugin)) return true;
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

  const unapproved = await approve(options.home, copies, options.approve);
  return {
    copies,
    configured: {
      project:
        projectDirectory === undefined
          ? []
          : fetchedBy(configuredTemplates(project.files, projectDirectory), copies),
      machine: fetchedBy(configuredTemplates(machine.files, machineDirectory), copies),
    },
    images: pluginFileImages({
      home: options.home,
      ...(projectDirectory === undefined || options.workspace === undefined
        ? {}
        : { workspace: options.workspace.folder }),
    }),
    texts,
    diagnostics,
    unapproved,
  };
}

/**
 * Records the approval of each copy that needs one, in `plugins.json` by name.
 *
 * A plugin that asks for no permissions needs nobody's yes. One whose permissions were all
 * approved before loads without asking; one that asks for more asks again, which is what
 * reinstalling does. A state file nobody can read approves nothing, and the load says so.
 */
async function approve(
  home: string,
  copies: readonly PluginFilesCopyOnDisk[],
  ask: PluginFilesApproval | undefined,
): Promise<string[]> {
  if (copies.length === 0) return [];
  const store = fsPluginStore(home);
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

    const yes =
      missing.length === 0 ||
      (ask !== undefined && (await ask(manifest, `${copy.git} at ${copy.ref}`)));
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
