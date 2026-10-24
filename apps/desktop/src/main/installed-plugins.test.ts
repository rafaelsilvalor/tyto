import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fsPluginStore } from '@tyto/io';
import {
  EMPTY_PLUGIN_STATE,
  PLUGIN_API_VERSION,
  PluginCapabilityError,
  checkedCapabilities,
  withPluginEntry,
} from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type NetFetch,
  credentialAccount,
  desktopCapabilities,
  startDesktopPlugins,
} from './installed-plugins.js';

/**
 * The desktop's network and secrets for a plugin, and how its installed folders are started
 * (TYTO-48). The permission check is `@tyto/plugin-api`'s; what is asserted here is what the
 * desktop puts behind it — `net.fetch` without redirects, and the keychain and nothing else.
 */

const noNetwork: NetFetch = () => Promise.reject(new Error('no network in this test'));

/** A keychain bound to a map, recording every account it was asked about. */
function keychain(entries: Record<string, string> = {}) {
  const stored = new Map(Object.entries(entries));
  const asked: string[] = [];
  return {
    stored,
    asked,
    get: (account: string) => {
      asked.push(account);
      return Promise.resolve(stored.get(account) ?? null);
    },
    set: (account: string, secret: string) => {
      asked.push(account);
      stored.set(account, secret);
      return Promise.resolve();
    },
    delete: (account: string) => {
      asked.push(account);
      return Promise.resolve(stored.delete(account));
    },
  };
}

describe('credentials on the desktop', () => {
  it('reads the keychain entry plugin:<name>:<key>, and nothing else', async () => {
    const keys = keychain({ 'plugin:meu-pdf:api-token': 's3cret' });
    const capabilities = desktopCapabilities(keys, noNetwork);
    const checked = checkedCapabilities('meu-pdf', ['credentials:api-token'], capabilities);

    expect(await checked.credentials('api-token')).toBe('s3cret');
    expect(keys.asked).toEqual([credentialAccount('meu-pdf', 'api-token')]);
  });

  it('stores and forgets under the same entry the plugin reads (ADR 0134)', async () => {
    const keys = keychain();
    const checked = checkedCapabilities(
      'meu-pdf',
      ['credentials:api-token'],
      desktopCapabilities(keys, noNetwork),
    );

    await checked.storeCredential('api-token', 'novo');
    expect([...keys.stored]).toEqual([['plugin:meu-pdf:api-token', 'novo']]);
    expect(await checked.credentials('api-token')).toBe('novo');
    expect(await checked.deleteCredential('api-token')).toBe(true);
    expect(await checked.deleteCredential('api-token')).toBe(false);
    expect(new Set(keys.asked)).toEqual(new Set(['plugin:meu-pdf:api-token']));
  });

  it('never names an account under the signin: prefix ADR 0131 reserves', () => {
    for (const [plugin, key] of [
      ['signin', 'x'],
      ['a', 'signin:b'],
      ['meu-pdf', 'api-token'],
    ] as const) {
      expect(credentialAccount(plugin, key).startsWith('plugin:')).toBe(true);
    }
  });

  it('says, when nothing is stored, where a person stores one', async () => {
    const capabilities = desktopCapabilities(keychain(), noNetwork);
    const checked = checkedCapabilities('meu-pdf', ['credentials:api-token'], capabilities);

    const refusal = await checked.credentials('api-token').catch((cause: unknown) => cause);
    expect(refusal).toBeInstanceOf(PluginCapabilityError);
    expect((refusal as PluginCapabilityError).code).toBe('E_CREDENTIAL_MISSING');
    expect((refusal as Error).message).toBe(
      "Plugin 'meu-pdf' asked for credential 'api-token', and the keychain entry " +
        "'plugin:meu-pdf:api-token' (set it in the plugins screen) " +
        'holds none.',
    );
  });
});

describe('the network on the desktop', () => {
  it('asks net.fetch never to follow a redirect, and answers the response whole', async () => {
    const asked: Parameters<NetFetch>[] = [];
    const netFetch: NetFetch = (url, init) => {
      asked.push([url, init]);
      return Promise.resolve({
        url,
        status: 302,
        statusText: 'Found',
        headers: [['location', '/elsewhere']],
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    };

    const fetched = await desktopCapabilities(keychain(), netFetch).fetch(
      'https://api.example.com/moved',
      { method: 'GET' },
    );

    expect(asked).toEqual([
      ['https://api.example.com/moved', { method: 'GET', redirect: 'manual' }],
    ]);
    expect(fetched).toMatchObject({ status: 302, headers: { location: '/elsewhere' } });
  });
});

describe('starting installed plugins', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'tyto-desktop-installed-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('refuses a folder with no dist/index.js without starting a process', async () => {
    const store = fsPluginStore(home);
    await mkdir(join(home, 'plugins', 'texto'), { recursive: true });
    await writeFile(
      join(home, 'plugins', 'texto', 'tyto-plugin.json'),
      JSON.stringify({
        name: 'texto',
        version: '1.0.0',
        engine: `>=${PLUGIN_API_VERSION}`,
        contributes: ['exporter'],
        permissions: [],
      }),
    );
    await store.writeState(
      withPluginEntry(EMPTY_PLUGIN_STATE, 'texto', { enabled: true, permissions: [], source: '.' }),
    );

    let launched = 0;
    const loaded = await startDesktopPlugins({
      store,
      launch: () => {
        launched += 1;
        throw new Error('not in this test');
      },
      capabilities: desktopCapabilities(keychain(), noNetwork),
    });

    expect(launched).toBe(0);
    expect(loaded.plugins).toEqual([]);
    expect(loaded.warnings.map((item) => item.message)).toEqual([
      "Plugin 'texto' was skipped: Plugin 'texto' failed to activate: it has no dist/index.js.",
    ]);
  });
});
