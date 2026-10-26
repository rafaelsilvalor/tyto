import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  DESKTOP_HOST_NAME,
  type DesktopPluginFiles,
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

describe("a plugin's cache and workspace files on the desktop (ADR 0138)", () => {
  let home: string;
  let first: string;
  let second: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'tyto-desktop-files-'));
    first = join(home, 'first');
    second = join(home, 'second');
    await mkdir(first);
    await mkdir(second);
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  /**
   * A window whose open folder and trust a test changes between two calls. Each answer is a
   * fresh object, as `workspace.state()` gives, so an answer kept at activation goes stale.
   */
  function window(state: ReturnType<DesktopPluginFiles['workspace']>) {
    const open = { ...state };
    const files: DesktopPluginFiles = {
      home: join(home, 'tyto-home'),
      workspace: () => ({ ...open }),
    };
    return { open, files };
  }

  async function refusal(promise: Promise<unknown>): Promise<string> {
    const cause = await promise.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(cause).toBeInstanceOf(PluginCapabilityError);
    return (cause as PluginCapabilityError).code;
  }

  it('asks for the open folder on every call, so a folder opened later is the one written', async () => {
    const { open, files } = window({ folder: first, trust: 'trusted' });
    const checked = checkedCapabilities(
      'tabelas',
      ['workspace:read', 'workspace:write'],
      desktopCapabilities(keychain(), noNetwork, files),
    );

    await checked.workspaceWrite('data/a.csv', new TextEncoder().encode('one'));
    open.folder = second;
    await checked.workspaceWrite('data/a.csv', new TextEncoder().encode('two'));

    expect(await readFile(join(first, 'data', 'a.csv'), 'utf8')).toBe('one');
    expect(await readFile(join(second, 'data', 'a.csv'), 'utf8')).toBe('two');
    expect(new TextDecoder().decode(await checked.workspaceRead('data/a.csv'))).toBe('two');
  });

  it('asks for the trust on every call: restricted refuses, trusted and revoked let it through', async () => {
    const { open, files } = window({ folder: first, trust: 'restricted' });
    const checked = checkedCapabilities(
      'tabelas',
      ['workspace:write'],
      desktopCapabilities(keychain(), noNetwork, files),
    );
    const bytes = new TextEncoder().encode('x');

    expect(await refusal(checked.workspaceWrite('a.csv', bytes))).toBe(
      'E_WORKSPACE_FILE_RESTRICTED',
    );
    open.trust = 'trusted';
    await checked.workspaceWrite('a.csv', bytes);
    // Taken back while open, it holds until the folder is opened again (ADR 0111).
    open.trust = 'revoked';
    await checked.workspaceWrite('b.csv', bytes);
    expect((await readdir(first)).sort()).toEqual(['a.csv', 'b.csv']);

    open.folder = null;
    expect(await refusal(checked.workspaceWrite('a.csv', bytes))).toBe('E_WORKSPACE_FILE');
  });

  it('keeps the cache in TYTO_HOME/cache/plugins/<plugin>, whatever folder is open', async () => {
    const { files } = window({ folder: null, trust: 'restricted' });
    const checked = checkedCapabilities(
      'tabelas',
      [],
      desktopCapabilities(keychain(), noNetwork, files),
    );

    await checked.cachePut('jira/issues', new TextEncoder().encode('[]'));

    const entry = await checked.cacheGet('jira/issues');
    expect(new TextDecoder().decode(entry?.bytes)).toBe('[]');
    const stored = await readdir(join(files.home, 'cache', 'plugins', 'tabelas'));
    expect(stored.filter((name) => name.endsWith('.bin'))).toHaveLength(1);
  });

  it('gives the refusals a name for the desktop', () => {
    const { files } = window({ folder: null, trust: 'restricted' });
    expect(desktopCapabilities(keychain(), noNetwork, files).hostName).toBe(DESKTOP_HOST_NAME);
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
