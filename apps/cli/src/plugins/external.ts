import { access } from 'node:fs/promises';
import { join } from 'node:path';

import type { Diagnostics } from '@tyto/core';
import { fsPluginStore } from '@tyto/io';
import { isRasterFormat } from '@tyto/pipeline';
import {
  type HostCapabilities,
  type InProcessHost,
  type InstalledPlugins,
  type LoadedPlugins,
  type PluginProcessLauncher,
  NO_PLUGINS,
  activateInstalled as activateInto,
  readInstalledPlugins as readFrom,
  startInstalledPlugins,
} from '@tyto/plugin-api';

import { launchPluginWorker } from './worker-channel.js';

/**
 * Installed plugins, from `~/.tyto` into a host (E11.1, `docs/plugin-api.md` Lifecycle).
 *
 * The rules are `@tyto/plugin-api`'s (`installed.ts`), shared with the desktop; what this
 * module adds is the CLI's composition: the store on `<home>`, a worker thread per plugin
 * (ADR 0041), and a file check for `dist/index.js`. A thread is a crash and API boundary,
 * **not a sandbox**: the plugin's code runs on the same Node with the same access to this
 * computer (TYTO-186).
 */

/** Where the code of an installed plugin is, relative to its folder (`docs/plugin-api.md`). */
export const PLUGIN_ENTRY = join('dist', 'index.js');

/** Every installed folder under `home` and whether it could load, without running any of it. */
export function readInstalledPlugins(home: string): Promise<InstalledPlugins> {
  return readFrom(fsPluginStore(home));
}

export interface LoadOptions {
  /** How a plugin's process is started. A worker thread, unless a test says otherwise. */
  readonly launch?: PluginProcessLauncher;
  /** What `host.fetch` and `host.credentials` reach, once a plugin's permissions allow it. */
  readonly capabilities?: HostCapabilities;
}

/** Starts every enabled plugin under `home` that passed its checks, once per process. */
export async function loadInstalledPlugins(
  home: string | undefined,
  options: LoadOptions = {},
): Promise<LoadedPlugins> {
  if (home === undefined) return NO_PLUGINS;
  const store = fsPluginStore(home);
  return startInstalledPlugins(store, {
    launch: options.launch ?? launchPluginWorker,
    entryOf: async (folder) => {
      const path = join(store.directoryOf(folder), PLUGIN_ENTRY);
      try {
        await access(path);
        return path;
      } catch {
        return undefined;
      }
    },
    ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
  });
}

/** Where `install` copied each plugin under `home` — what a pack's `directory` is relative to. */
export function pluginFolders(home: string): (plugin: string) => string {
  const store = fsPluginStore(home);
  return (plugin) => store.directoryOf(plugin);
}

/** Activates started plugins into one host, after the built-ins; raster kinds are `@tyto/raster`'s. */
export function activateInstalled(host: InProcessHost, loaded: LoadedPlugins): Diagnostics {
  return activateInto(host, loaded, { encodes: isRasterFormat, encodable: 'png, jpeg and webp' });
}

export {
  type InstalledEntry,
  type InstalledPlugins,
  type LoadedPlugins,
  NO_PLUGINS,
  writeCrash,
} from '@tyto/plugin-api';
