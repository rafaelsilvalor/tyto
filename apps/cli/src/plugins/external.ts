import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { type Diagnostic, type Diagnostics, diagnostic } from '@tyto/core';
import { fsPluginStore } from '@tyto/io';
import { isRasterFormat } from '@tyto/pipeline';
import {
  type InProcessHost,
  type IsolatedPlugin,
  PLUGIN_API_VERSION,
  type Plugin,
  type PluginCrash,
  type PluginManifest,
  type PluginProcessLauncher,
  type PluginState,
  type PluginStore,
  EMPTY_PLUGIN_CRASHES,
  checkStoredPlugin,
  connectIsolatedPlugin,
  skippedPluginWarnings,
  withPluginCrash,
} from '@tyto/plugin-api';

import { launchPluginWorker } from './worker-channel.js';

/**
 * Installed plugins, from `~/.tyto` into a host (E11.1, `docs/plugin-api.md` Lifecycle).
 *
 * Two steps with two lifetimes, for the reason `activateBuiltIns` is per render: reading
 * the folders and starting the code happens **once per process**, and activating happens
 * **once per host**. `tyto watch` builds a host per task, and starting a plugin per task
 * would load the same code again for every folder in the inbox.
 *
 * **In a worker thread of its own** (ADR 0041). Each plugin's module is imported by a
 * worker, and what reaches a task's host is a proxy that calls it there, so a plugin that
 * crashes costs the frames waiting on it and not the command. A thread is a crash and API
 * boundary, **not a sandbox**: the plugin's code runs on the same Node with the same
 * access to this computer (TYTO-186).
 */

/** Where the code of an installed plugin is, relative to its folder (`docs/plugin-api.md`). */
export const PLUGIN_ENTRY = join('dist', 'index.js');

/** One installed folder, as the listing and the loader both see it. */
export interface InstalledEntry {
  readonly folder: string;
  /** Present when the folder passed every check that reads no code. */
  readonly manifest?: PluginManifest;
  /** `install` wrote an entry for it. A folder copied in by hand has none. */
  readonly recorded: boolean;
  /** Recorded and not disabled. */
  readonly enabled: boolean;
  /** Why it will not load, when it will not. Errors: the listing's and `enable`'s view. */
  readonly problems: Diagnostics;
}

export interface InstalledPlugins {
  readonly store: PluginStore;
  /** Absent when `plugins.json` could not be read; see {@link stateProblems}. */
  readonly state?: PluginState;
  readonly entries: readonly InstalledEntry[];
  /**
   * A state file that could not be read. Every folder carries these as its problems too:
   * a file that cannot say which plugins were approved cannot approve any of them.
   */
  readonly stateProblems: Diagnostics;
}

/** Every installed folder and whether it could load, without running any of it. */
export async function readInstalledPlugins(home: string): Promise<InstalledPlugins> {
  const store = fsPluginStore(home);
  const [stateRead, stored] = await Promise.all([store.readState(), store.list()]);

  if (!stateRead.ok) {
    const entries = stored.map((plugin): InstalledEntry => ({
      folder: plugin.folder,
      recorded: false,
      enabled: false,
      problems: stateRead.error,
    }));
    return { store, entries, stateProblems: stateRead.error };
  }

  const state = stateRead.value;
  const entries = stored.map((plugin): InstalledEntry => {
    const record = state.plugins[plugin.folder];
    const flags = { recorded: record !== undefined, enabled: record?.enabled === true };
    const checked = checkStoredPlugin(plugin, state, PLUGIN_API_VERSION);
    return checked.ok
      ? { folder: plugin.folder, manifest: checked.value, ...flags, problems: [] }
      : { folder: plugin.folder, ...flags, problems: checked.error };
  });

  return { store, state, entries, stateProblems: [] };
}

function importFailure(plugin: string, problem: string): Diagnostic {
  return diagnostic('E_PLUGIN_ACTIVATE', { plugin, problem });
}

/**
 * Writes a plugin's crash into `crashes.json`, or clears it when handed nothing.
 *
 * Read again first rather than written from what this process started with, because
 * another command may have written the file since. An unreadable file is replaced: it is
 * history, and a record nobody can read is not one worth keeping over a new one.
 */
export async function writeCrash(
  store: PluginStore,
  name: string,
  crash: PluginCrash | undefined,
): Promise<void> {
  const read = await store.readCrashes();
  const crashes = read.ok ? read.value : EMPTY_PLUGIN_CRASHES;
  if (crash === undefined && crashes.crashes[name] === undefined) return;
  await store.writeCrashes(withPluginCrash(crashes, name, crash));
}

async function startPlugin(
  store: PluginStore,
  entry: InstalledEntry & { readonly manifest: PluginManifest },
  launch: PluginProcessLauncher,
  crashes: Promise<void>[],
): Promise<IsolatedPlugin | Diagnostics> {
  const path = join(store.directoryOf(entry.folder), PLUGIN_ENTRY);
  try {
    await access(path);
  } catch {
    return [importFailure(entry.folder, `it has no ${PLUGIN_ENTRY.replaceAll('\\', '/')}`)];
  }

  const connected = await connectIsolatedPlugin({
    name: entry.folder,
    // The validated manifest, handed over as the document it was: the host validates it
    // again at `tryActivate`, which is the one check a plugin cannot skip (ADR 0007).
    manifest: entry.manifest as unknown,
    channel: launch({ name: entry.folder, entry: path }),
    onCrash: (reason) => {
      // Kept, so `close` can wait for it: a CLI that exits mid-write loses the record.
      const crash = { at: new Date().toISOString(), reason };
      crashes.push(writeCrash(store, entry.folder, crash).catch(() => undefined));
    },
  });
  return connected.ok ? connected.value : connected.error;
}

/** What a render activates: the plugins that started, and warnings for what did not. */
export interface LoadedPlugins {
  readonly plugins: readonly Plugin[];
  readonly warnings: Diagnostics;
  /** Ends every plugin's process, and waits for any crash still being written down. */
  close(): Promise<void>;
}

export const NO_PLUGINS: LoadedPlugins = {
  plugins: [],
  warnings: [],
  close: () => Promise.resolve(),
};

export interface LoadOptions {
  /** How a plugin's process is started. A worker thread, unless a test says otherwise. */
  readonly launch?: PluginProcessLauncher;
}

/**
 * Starts every enabled plugin that passed its checks, once.
 *
 * A disabled plugin is neither started nor mentioned: disabling is somebody's decision,
 * and a warning on every render about it would be the app arguing with them.
 */
export async function loadInstalledPlugins(
  home: string | undefined,
  options: LoadOptions = {},
): Promise<LoadedPlugins> {
  if (home === undefined) return NO_PLUGINS;

  const installed = await readInstalledPlugins(home);
  const launch = options.launch ?? launchPluginWorker;
  const warnings: Diagnostic[] = [];
  const started: IsolatedPlugin[] = [];
  const crashes: Promise<void>[] = [];

  for (const entry of installed.entries) {
    if (entry.recorded && !entry.enabled) continue;
    if (entry.manifest === undefined) {
      warnings.push(...skippedPluginWarnings(entry.folder, entry.problems));
      continue;
    }

    const plugin = await startPlugin(
      installed.store,
      { ...entry, manifest: entry.manifest },
      launch,
      crashes,
    );
    if ('plugin' in plugin) {
      started.push(plugin);
    } else {
      warnings.push(...skippedPluginWarnings(entry.folder, plugin));
    }
  }

  return {
    plugins: started.map((plugin) => plugin.plugin),
    warnings,
    async close() {
      await Promise.all(started.map((plugin) => plugin.close()));
      await Promise.all(crashes);
    },
  };
}

/**
 * Activates imported plugins into one host, after the built-ins.
 *
 * After, so a built-in always wins an id: a plugin that registers its own `svg` exporter is
 * the one refused, by name, and the run renders with Tyto's (TYTO-47).
 */
export function activateInstalled(host: InProcessHost, loaded: LoadedPlugins): Diagnostics {
  const warnings: Diagnostic[] = [...loaded.warnings];
  for (const plugin of loaded.plugins) {
    const before = new Set(host.registry.exporters.list().map((exporter) => exporter.id));
    const activated = host.tryActivate(plugin, 'external');
    if (!activated.ok) {
      warnings.push(...skippedPluginWarnings(plugin.id, activated.error));
      continue;
    }

    const unencodable = unencodableKinds(plugin.id, host, before);
    if (unencodable.length > 0) {
      host.disposePlugin(plugin.id);
      warnings.push(...skippedPluginWarnings(plugin.id, unencodable));
    }
  }
  return warnings;
}

/**
 * A rasterized exporter promising a kind no rasterizer encodes (`gif`), as data.
 *
 * Checked here rather than in `@tyto/plugin-api`, because which kinds a rasterizer encodes is
 * `@tyto/raster`'s knowledge and that package is Node. Refusing the plugin at activation is
 * what keeps a third party's promise from reaching `runJob`, whose `TypeError` for the same
 * case is a wiring check for this repository and would be exit 2 — an internal failure — for
 * somebody else's mistake.
 */
function unencodableKinds(
  pluginId: string,
  host: InProcessHost,
  before: ReadonlySet<string>,
): Diagnostic[] {
  return host.registry.exporters
    .list()
    .filter((exporter) => exporter.rasterized && !before.has(exporter.id))
    .flatMap((exporter) =>
      exporter.kinds
        .filter((kind) => !isRasterFormat(kind))
        .map((kind) =>
          diagnostic('E_PLUGIN_EXPORTER_KIND', {
            plugin: pluginId,
            exporter: exporter.id,
            kind,
            encodable: 'png, jpeg and webp',
          }),
        ),
    );
}
