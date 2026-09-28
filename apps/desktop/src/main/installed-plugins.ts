import { access } from 'node:fs/promises';
import { join } from 'node:path';

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

/**
 * Installed plugins, started for the desktop (E11.2, ADR 0044).
 *
 * The rules — what is enabled, what passed its checks, how a crash is recorded — are
 * `@tyto/plugin-api`'s `startInstalledPlugins`, the same the CLI runs. What this module
 * composes is the desktop's half: a `utilityProcess` per plugin, Electron's `net.fetch` for
 * `host.fetch`, and `safeStorage` for `host.credentials`. **Never activated in main**: what
 * reaches an export's host is a proxy of a plugin living in its own process.
 */

/** Where the code of an installed plugin is, relative to its folder. */
const PLUGIN_ENTRY = join('dist', 'index.js');

/** The keychain entry a plugin's credential lives under. */
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
 * nobody has stored answers `E_CREDENTIAL_MISSING`, and its message says the app has no
 * screen to store one yet (TYTO-187).
 */
export function desktopCapabilities(
  credentials: Pick<Credentials, 'get'>,
  netFetch: NetFetch,
): HostCapabilities {
  return {
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
    describeCredential: (plugin, key) =>
      `the keychain entry '${credentialAccount(plugin, key)}' (this version of the app has ` +
      'no screen to store one yet)',
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
    // Not yet: a `utilityProcess` accepts `--permission` and does not enforce it, measured, so
    // the desktop is a crash boundary only until it starts plugins on a bundled Node
    // (ADR 0049, the second TYTO-186 pull request).
    requireSandbox: false,
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
