import { access } from 'node:fs/promises';
import { join } from 'node:path';

import type { Diagnostics } from '@tyto/core';
import { type PluginFilesCopyOnDisk, fsPluginStore, pluginStoreWithCopies } from '@tyto/io';
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
  resolveSettings,
  startInstalledPlugins,
} from '@tyto/plugin-api';

/**
 * Installed plugins, from `~/.tyto` into a host (E11.1, `docs/plugin-api.md` Lifecycle).
 *
 * The rules are `@tyto/plugin-api`'s (`installed.ts`), shared with the desktop; what this
 * module adds is the commands' composition: the store on `<home>`, a child process per plugin
 * through the app's launcher, and a file check for `dist/index.js`. The CLI requires the
 * sandbox: a plugin whose process cannot prove it is confined to its folder is refused before
 * its code is imported (ADR 0049).
 */

/** Where the code of an installed plugin is, relative to its folder (`docs/plugin-api.md`). */
export const PLUGIN_ENTRY = join('dist', 'index.js');

/** Every installed folder under `home` and whether it could load, without running any of it. */
export function readInstalledPlugins(home: string): Promise<InstalledPlugins> {
  return readFrom(fsPluginStore(home));
}

export interface LoadOptions {
  /**
   * How a plugin's process is started: the environment's `launch` (ADR 0159). Absent, a plugin
   * that would start is an internal failure, because an app that runs commands against a
   * `home` and chose no launcher is a composition that was never finished.
   */
  readonly launch?: PluginProcessLauncher | undefined;
  /** What `host.fetch` and `host.credentials` reach, once a plugin's permissions allow it. */
  readonly capabilities?: HostCapabilities;
  /** The plugin files' copies, loaded before the installed plugins and over their names. */
  readonly copies?: readonly PluginFilesCopyOnDisk[];
}

/** The installed plugins' store, with the plugin files' copies in front when there are any. */
function storeOf(home: string, copies: readonly PluginFilesCopyOnDisk[] = []) {
  return copies.length === 0 ? fsPluginStore(home) : pluginStoreWithCopies(home, copies);
}

/** What starts a plugin when the environment chose nothing: it refuses, by name. */
const noLauncher: PluginProcessLauncher = (request) => {
  throw new Error(
    `No plugin launcher in this environment, so '${request.name}' cannot start. ` +
      'The app that runs the commands sets `launch` beside `home`.',
  );
};

/** Starts every enabled plugin under `home` that passed its checks, once per process. */
export async function loadInstalledPlugins(
  home: string | undefined,
  options: LoadOptions = {},
): Promise<LoadedPlugins> {
  if (home === undefined) return NO_PLUGINS;
  const store = storeOf(home, options.copies);
  return startInstalledPlugins(store, {
    launch: options.launch ?? noLauncher,
    requireSandbox: true,
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

/** Where each plugin's folder is — what a pack's `directory` is relative to. */
export function pluginFolders(
  home: string,
  copies: readonly PluginFilesCopyOnDisk[] = [],
): (plugin: string) => string {
  const store = storeOf(home, copies);
  return (plugin) => store.directoryOf(plugin);
}

/** Activates started plugins into one host, after the built-ins; raster kinds are `@tyto/raster`'s. */
export function activateInstalled(host: InProcessHost, loaded: LoadedPlugins): Diagnostics {
  const warnings = activateInto(host, loaded, {
    encodes: isRasterFormat,
    encodable: 'png, jpeg and webp',
  });
  configureDefaults(host);
  return warnings;
}

/**
 * Hands every declared setting its default (ADR 0145). The CLI never reads the window's
 * `settings.json` — it is one machine's preference, and a render must not change with it — so an
 * installed plugin's setting reads its default here. Values a project chooses never come through
 * here: `configure` is process-wide and the last one wins, so a folder's values would leak into
 * the next folder's run. They are the plugin's section of `.tyto/project.json`, handed on each
 * source and recipe verb call (ADR 0147), with `tyto render --section` typed over it.
 */
export function configureDefaults(host: InProcessHost): void {
  host.configure(resolveSettings(host.registry.configurations(), []).config);
}

export {
  type InstalledEntry,
  type InstalledPlugins,
  type LoadedPlugins,
  NO_PLUGINS,
  writeCrash,
} from '@tyto/plugin-api';
