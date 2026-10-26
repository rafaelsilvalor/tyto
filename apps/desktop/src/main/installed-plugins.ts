import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { pluginCache, workspaceFiles } from '@tyto/io';
import type {
  FetchedResponse,
  HostCapabilities,
  HostFetchInit,
  LoadedPlugins,
  PluginProcessLauncher,
  PluginStore,
} from '@tyto/plugin-api';
import { startInstalledPlugins } from '@tyto/plugin-api';

import type { Credentials } from './credentials.js';
import type { WorkspaceState } from './workspace.js';

/**
 * Installed plugins, started for the desktop (E11.2, ADR 0044).
 *
 * The rules — what is enabled, what passed its checks, how a crash is recorded — are
 * `@tyto/plugin-api`'s `startInstalledPlugins`, the same the CLI runs. What this module
 * composes is the desktop's half: a process per plugin on the bundled Node, Electron's `net.fetch` for
 * `host.fetch`, `safeStorage` for `host.credentials`, and `TYTO_HOME` and the open folder for
 * `host.cache` and `host.workspace` (ADR 0138). **Never activated in main**: what
 * reaches an export's host is a proxy of a plugin living in its own process.
 */

/** Where the code of an installed plugin is, relative to its folder. */
const PLUGIN_ENTRY = join('dist', 'index.js');

/**
 * The keychain entry a plugin's credential lives under. Always `plugin:`-prefixed, which is
 * what keeps the `signin:<plugin>:<id>` accounts reserved for browser sign-in tokens
 * (ADR 0131, ADR 0134) out of reach of any `credentials:<key>` a manifest declares.
 */
export function credentialAccount(plugin: string, key: string): string {
  return `plugin:${plugin}:${key}`;
}

/** `net.fetch`, as far as this module calls it: a `fetch` with Chromium's network stack. */
export type NetFetch = (
  url: string,
  init: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string | Uint8Array;
    readonly redirect: 'manual';
  },
) => Promise<{
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Iterable<[string, string]>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * The network and the secrets behind a plugin's permissions, for the desktop.
 *
 * **`safeStorage` and nothing else** for a credential (`CLAUDE.md`): no environment
 * variable, because on the desktop the one place a secret lives is the OS keychain. A key
 * nobody has stored answers `E_CREDENTIAL_MISSING`, and its message points to the plugins
 * screen, where a person stores one (TYTO-187), or the plugin stores itself (ADR 0134).
 */
export function desktopCapabilities(
  credentials: Pick<Credentials, 'get' | 'set' | 'delete'>,
  netFetch: NetFetch,
  files?: DesktopPluginFiles,
): HostCapabilities {
  return {
    ...(files === undefined ? {} : desktopPluginFiles(files)),
    async fetch(url: string, init: HostFetchInit): Promise<FetchedResponse> {
      const response = await netFetch(url, {
        ...(init.method === undefined ? {} : { method: init.method }),
        ...(init.headers === undefined ? {} : { headers: { ...init.headers } }),
        ...(init.body === undefined ? {} : { body: init.body }),
        // Never followed, so a declared host cannot hand the request to an undeclared one;
        // the plugin gets the 3xx and asks again, through the check (ADR 0042).
        redirect: 'manual',
      });
      return {
        url: response.url === '' ? url : response.url,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers),
        body: new Uint8Array(await response.arrayBuffer()),
      };
    },
    async credential(plugin, key) {
      return (await credentials.get(credentialAccount(plugin, key))) ?? undefined;
    },
    storeCredential: (plugin, key, value) => credentials.set(credentialAccount(plugin, key), value),
    deleteCredential: (plugin, key) => credentials.delete(credentialAccount(plugin, key)),
    describeCredential: (plugin, key) =>
      `the keychain entry '${credentialAccount(plugin, key)}' (set it in the plugins screen)`,
  };
}

/** The name a refusal gives the desktop when a port is missing (ADR 0138). */
export const DESKTOP_HOST_NAME = 'Tyto desktop';

/** Where a plugin's cache lives and which folder its workspace files are read in. */
export interface DesktopPluginFiles {
  /** `TYTO_HOME`, the same the plugins and their sources' cache live in (ADR 0117). */
  readonly home: string;
  /** What main has open now: the answer `workspace:folder` gives the window. */
  readonly workspace: () => Pick<WorkspaceState, 'folder' | 'trust'>;
}

/** The six ports of ADR 0138 and the name their refusals give. */
export type DesktopPluginFilePorts = Required<
  Pick<
    HostCapabilities,
    | 'hostName'
    | 'cacheGet'
    | 'cachePut'
    | 'cacheDelete'
    | 'cacheList'
    | 'workspaceRead'
    | 'workspaceWrite'
  >
>;

/**
 * A plugin's private cache and the open folder's files (ADR 0138), for the desktop.
 *
 * **The folder and its trust are asked of `workspace` on every call**, never fixed here: a
 * plugin's process is started once for the app's life and outlives File ▸ Open Folder, so a
 * folder captured at activation would be the wrong one after the first switch. A trust taken
 * back while the folder is open (`revoked`) still holds until it is opened again (ADR 0111),
 * as it does for everything else the folder gives.
 */
export function desktopPluginFiles(files: DesktopPluginFiles): DesktopPluginFilePorts {
  return {
    hostName: DESKTOP_HOST_NAME,
    ...pluginCache({ home: files.home }),
    ...workspaceFiles({
      folder: () => files.workspace().folder ?? undefined,
      trust: () => (files.workspace().trust === 'restricted' ? 'restricted' : 'trusted'),
    }),
  };
}

export interface DesktopPluginsOptions {
  readonly store: PluginStore;
  readonly launch: PluginProcessLauncher;
  readonly capabilities: HostCapabilities;
}

/** Starts every installed, enabled plugin that passed its checks, once for the app's life. */
export function startDesktopPlugins(options: DesktopPluginsOptions): Promise<LoadedPlugins> {
  const { store } = options;
  return startInstalledPlugins(store, {
    launch: options.launch,
    capabilities: options.capabilities,
    // Each plugin's process runs on the bundled Node and must prove it is confined before its
    // code is imported (ADR 0049, ADR 0050).
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
  });
}
