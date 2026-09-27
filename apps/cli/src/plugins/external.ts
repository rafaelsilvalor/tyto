import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type Diagnostic, type Diagnostics, diagnostic } from '@tyto/core';
import { fsPluginStore } from '@tyto/io';
import { isRasterFormat } from '@tyto/pipeline';
import {
  type InProcessHost,
  PLUGIN_API_VERSION,
  type Plugin,
  type PluginManifest,
  type PluginState,
  type PluginStore,
  checkStoredPlugin,
  skippedPluginWarnings,
} from '@tyto/plugin-api';

/**
 * Installed plugins, from `~/.tyto` into a host (E11.1, `docs/plugin-api.md` Lifecycle).
 *
 * Two steps with two lifetimes, for the reason `activateBuiltIns` is per render: reading
 * the folders and importing the code happens **once per process**, and activating happens
 * **once per host**. `tyto watch` builds a host per task, and importing a plugin's module
 * per task would load the same code again for every folder in the inbox.
 *
 * **In process, and with Tyto's reach.** The code is imported with `import()` into this
 * process; a permission the person approved is recorded and shown and not enforced. That
 * is E11.2 (TYTO-48), and until it lands an installed plugin is trusted the way an npm
 * dependency is (ADR 0040).
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

async function importPlugin(
  store: PluginStore,
  entry: InstalledEntry & { readonly manifest: PluginManifest },
): Promise<Plugin | Diagnostic> {
  const path = join(store.directoryOf(entry.folder), PLUGIN_ENTRY);
  try {
    await access(path);
  } catch {
    return importFailure(entry.folder, `it has no ${PLUGIN_ENTRY.replaceAll('\\', '/')}`);
  }

  let module: { readonly activate?: unknown };
  try {
    module = (await import(pathToFileURL(path).href)) as { readonly activate?: unknown };
  } catch (cause) {
    return importFailure(entry.folder, cause instanceof Error ? cause.message : String(cause));
  }

  const { activate } = module;
  if (typeof activate !== 'function') {
    return importFailure(entry.folder, `${PLUGIN_ENTRY} exports no activate function`);
  }

  return {
    id: entry.folder,
    // The validated manifest, handed over as the document it was: the host validates it
    // again at `tryActivate`, which is the one check a plugin cannot skip (ADR 0007).
    manifest: entry.manifest as unknown,
    activate: activate as Plugin['activate'],
  };
}

/** What a render activates: the code that imported, and warnings for what did not. */
export interface LoadedPlugins {
  readonly plugins: readonly Plugin[];
  readonly warnings: Diagnostics;
}

export const NO_PLUGINS: LoadedPlugins = { plugins: [], warnings: [] };

/**
 * Imports every enabled plugin that passed its checks, once.
 *
 * A disabled plugin is neither imported nor mentioned: disabling is somebody's decision,
 * and a warning on every render about it would be the app arguing with them.
 */
export async function loadInstalledPlugins(home: string | undefined): Promise<LoadedPlugins> {
  if (home === undefined) return NO_PLUGINS;

  const installed = await readInstalledPlugins(home);
  const warnings: Diagnostic[] = [];
  const plugins: Plugin[] = [];

  for (const entry of installed.entries) {
    if (entry.recorded && !entry.enabled) continue;
    if (entry.manifest === undefined) {
      warnings.push(...skippedPluginWarnings(entry.folder, entry.problems));
      continue;
    }

    const imported = await importPlugin(installed.store, { ...entry, manifest: entry.manifest });
    if ('code' in imported) {
      warnings.push(...skippedPluginWarnings(entry.folder, [imported]));
    } else {
      plugins.push(imported);
    }
  }

  return { plugins, warnings };
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
