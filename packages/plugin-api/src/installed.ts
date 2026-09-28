import { type Diagnostic, type Diagnostics, diagnostic } from '@tyto/core';

import type { HostCapabilities } from './capabilities.js';
import { EMPTY_PLUGIN_CRASHES, type PluginCrash, withPluginCrash } from './crashes.js';
import { PLUGIN_API_VERSION } from './engine.js';
import type { InProcessHost, Plugin } from './host.js';
import type { PluginProcessLauncher } from './isolation/channel.js';
import { type IsolatedPlugin, connectIsolatedPlugin } from './isolation/isolated-plugin.js';
import { type PluginStore, checkStoredPlugin, skippedPluginWarnings } from './loader.js';
import type { PluginManifest } from './manifest.js';
import type { PluginState } from './state.js';

/**
 * Installed plugins, from a `PluginStore` into a host — the half both apps share
 * (E11.1, E11.2, `docs/plugin-api.md` Lifecycle).
 *
 * Two steps with two lifetimes, for the reason a render's host is per render: reading the
 * folders and starting the code happens **once per process**, and activating happens
 * **once per host**. `tyto watch` and the desktop's export both build a host per run, and
 * starting a plugin per run would load the same code again every time.
 *
 * **Ports only** (ADR 0010). The store reads the disk, `launch` starts the plugin's process
 * — a confined child process in the CLI, a `utilityProcess` in the desktop — and `entryOf` says
 * where a plugin's code is and whether it is there. So the rules, and the order they are
 * applied in, are one copy for both apps; what differs between them is only what they
 * compose. A plugin's process is a crash and API boundary, and where the app's runtime can
 * confine it, a sandbox too: `requireSandbox` says which (ADR 0049).
 */

/** Where the code of an installed plugin is, relative to its folder, as messages spell it. */
export const PLUGIN_ENTRY_PATH = 'dist/index.js';

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
export async function readInstalledPlugins(store: PluginStore): Promise<InstalledPlugins> {
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

export interface StartOptions {
  /** Starts one plugin's process. */
  readonly launch: PluginProcessLauncher;
  /**
   * The absolute path of a plugin's `dist/index.js`, or `undefined` when its folder has
   * none — asked of the app, because whether a file exists is a disk's answer.
   */
  entryOf(folder: string): Promise<string | undefined>;
  /** What `host.fetch` and `host.credentials` reach, once a plugin's permissions allow it. */
  readonly capabilities?: HostCapabilities;
  /** Whether each plugin's process must prove it is confined to its folder (ADR 0049). */
  readonly requireSandbox: boolean;
}

function importFailure(plugin: string, problem: string): Diagnostic {
  return diagnostic('E_PLUGIN_ACTIVATE', { plugin, problem });
}

async function startPlugin(
  store: PluginStore,
  entry: InstalledEntry & { readonly manifest: PluginManifest },
  options: StartOptions,
  crashes: Promise<void>[],
): Promise<IsolatedPlugin | Diagnostics> {
  const path = await options.entryOf(entry.folder);
  if (path === undefined) {
    return [importFailure(entry.folder, `it has no ${PLUGIN_ENTRY_PATH}`)];
  }

  // Checked on every load, not only at install: the permission model follows a link out of
  // the folder it granted (ADR 0049), and a folder can change after it was installed.
  const links = await store.linksLeaving(entry.folder);
  if (links.length > 0) return links;

  const connected = await connectIsolatedPlugin({
    name: entry.folder,
    // The validated manifest, handed over as the document it was: the host validates it
    // again at `tryActivate`, which is the one check a plugin cannot skip (ADR 0007).
    manifest: entry.manifest as unknown,
    channel: options.launch({
      name: entry.folder,
      entry: path,
      directory: store.directoryOf(entry.folder),
    }),
    requireSandbox: options.requireSandbox,
    ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
    onCrash: (reason) => {
      // Kept, so `close` can wait for it: an app that exits mid-write loses the record.
      const crash = { at: new Date().toISOString(), reason };
      crashes.push(writeCrash(store, entry.folder, crash).catch(() => undefined));
    },
  });
  return connected.ok ? connected.value : connected.error;
}

/**
 * Starts every enabled plugin that passed its checks, once.
 *
 * A disabled plugin is neither started nor mentioned: disabling is somebody's decision,
 * and a warning on every render about it would be the app arguing with them.
 */
export async function startInstalledPlugins(
  store: PluginStore,
  options: StartOptions,
): Promise<LoadedPlugins> {
  const installed = await readInstalledPlugins(store);
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
      store,
      { ...entry, manifest: entry.manifest },
      options,
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

export interface ActivateOptions {
  /**
   * Whether a rasterizer encodes this kind. The app's answer: which kinds a rasterizer
   * encodes is `@tyto/raster`'s knowledge, and that package is Node.
   */
  encodes(kind: string): boolean;
  /** The kinds it does encode, as the refusal names them: `png, jpeg and webp`. */
  readonly encodable: string;
}

/**
 * Activates started plugins into one host, after the built-ins.
 *
 * After, so a built-in always wins an id: a plugin that registers its own `svg` exporter is
 * the one refused, by name, and the run renders with Tyto's (TYTO-47).
 *
 * A rasterized exporter promising a kind no rasterizer encodes (`gif`) is refused here, as
 * data. Refusing the plugin at activation is what keeps a third party's promise from reaching
 * `runJob`, whose `TypeError` for the same case is a wiring check for this repository and
 * would be an internal failure for somebody else's mistake.
 */
export function activateInstalled(
  host: InProcessHost,
  loaded: LoadedPlugins,
  options: ActivateOptions,
): Diagnostics {
  const warnings: Diagnostic[] = [...loaded.warnings];
  for (const plugin of loaded.plugins) {
    const before = new Set(host.registry.exporters.list().map((exporter) => exporter.id));
    const activated = host.tryActivate(plugin, 'external');
    if (!activated.ok) {
      warnings.push(...skippedPluginWarnings(plugin.id, activated.error));
      continue;
    }

    const unencodable = host.registry.exporters
      .list()
      .filter((exporter) => exporter.rasterized && !before.has(exporter.id))
      .flatMap((exporter) =>
        exporter.kinds
          .filter((kind) => !options.encodes(kind))
          .map((kind) =>
            diagnostic('E_PLUGIN_EXPORTER_KIND', {
              plugin: plugin.id,
              exporter: exporter.id,
              kind,
              encodable: options.encodable,
            }),
          ),
      );
    if (unencodable.length > 0) {
      host.disposePlugin(plugin.id);
      warnings.push(...skippedPluginWarnings(plugin.id, unencodable));
    }
  }
  return warnings;
}
