import { diagnostic } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import {
  CREDENTIAL_VALUE_LIMIT_BYTES,
  type FetchedResponse,
  type HostCapabilities,
  PLUGIN_CACHE_KEY_LIMIT_BYTES,
  PLUGIN_FILE_LIMIT_BYTES,
  type PluginCacheEntry,
  PluginCapabilityError,
  allowsHost,
  checkedCapabilities,
  workspacePath,
} from './capabilities.js';
import { createPluginHost } from './host.js';

/**
 * `host.fetch` and `host.credentials`, as the host decides them (TYTO-48).
 *
 * Every refusal is asserted **together with the adapter's call count**, because "rejected"
 * and "rejected before anything was sent" are different claims, and only the second is a
 * permission.
 */

const OK: FetchedResponse = {
  url: 'https://api.example.com/',
  status: 200,
  statusText: 'OK',
  headers: {},
  body: new Uint8Array([123, 125]),
};

function recording(values: Readonly<Record<string, string>> = {}) {
  const fetched: string[] = [];
  const capabilities: HostCapabilities = {
    fetch: (url) => {
      fetched.push(url);
      return Promise.resolve({ ...OK, url });
    },
    credential: (plugin, key) => Promise.resolve(values[`${plugin}/${key}`]),
    describeCredential: (plugin, key) => `the variable for ${plugin}/${key}`,
  };
  return { fetched, capabilities };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (cause) {
    return cause instanceof PluginCapabilityError ? cause.code : `${String(cause)}`;
  }
}

describe('net: permissions', () => {
  it.each([
    [['net:api.example.com'], 'api.example.com', true],
    [['net:api.example.com'], 'API.example.com', true],
    [['net:api.example.com'], 'cdn.example.com', false],
    [['net:*.example.com'], 'cdn.example.com', true],
    [['net:*.example.com'], 'a.b.example.com', true],
    [['net:*.example.com'], 'example.com', false],
    [['net:*.example.com'], 'badexample.com', false],
    [['net:*'], 'anything.test', true],
    [['credentials:net'], 'net', false],
    [[], 'api.example.com', false],
  ])('%j reaches %s: %s', (permissions, host, allowed) => {
    expect(allowsHost(permissions, host)).toBe(allowed);
  });
});

describe('host.fetch', () => {
  it('refuses an undeclared host with E_PERMISSION, and sends nothing', async () => {
    const { fetched, capabilities } = recording();
    const checked = checkedCapabilities('texto', ['net:api.example.com'], capabilities);

    expect(await codeOf(checked.fetch('https://evil.example.org/steal'))).toBe('E_PERMISSION');
    await expect(checked.fetch('https://evil.example.org/')).rejects.toThrow(
      "Plugin 'texto' called 'host.fetch to evil.example.org (net:evil.example.org)' without " +
        'that permission being granted at install time.',
    );
    expect(fetched).toEqual([]);
  });

  it('refuses a scheme no net: permission covers, whatever is declared', async () => {
    const { fetched, capabilities } = recording();
    const checked = checkedCapabilities('texto', ['net:*'], capabilities);

    expect(await codeOf(checked.fetch('file:///etc/passwd'))).toBe('E_PERMISSION');
    expect(fetched).toEqual([]);
  });

  it('reaches a declared host through the adapter', async () => {
    const { fetched, capabilities } = recording();
    const checked = checkedCapabilities('texto', ['net:*.example.com'], capabilities);

    expect((await checked.fetch('https://api.example.com/v1')).status).toBe(200);
    expect(fetched).toEqual(['https://api.example.com/v1']);
  });
});

describe('host.credentials', () => {
  const values = { 'texto/api-token': 's3cret' };

  it('resolves a declared key', async () => {
    const { capabilities } = recording(values);
    const checked = checkedCapabilities('texto', ['credentials:api-token'], capabilities);
    expect(await checked.credentials('api-token')).toBe('s3cret');
  });

  it('refuses an undeclared key with E_PERMISSION, even one the host holds', async () => {
    const { capabilities } = recording({ ...values, 'texto/other': 'x' });
    const checked = checkedCapabilities('texto', ['credentials:api-token'], capabilities);
    expect(await codeOf(checked.credentials('other'))).toBe('E_PERMISSION');
  });

  it('answers E_CREDENTIAL_MISSING for a declared key with no value, saying where it looked', async () => {
    const { capabilities } = recording();
    const checked = checkedCapabilities('texto', ['credentials:api-token'], capabilities);
    await expect(checked.credentials('api-token')).rejects.toThrow(
      "Plugin 'texto' asked for credential 'api-token', and the variable for texto/api-token holds none.",
    );
  });
});

/** A host whose secrets a plugin may write, keyed `plugin/key`, counting every write. */
function writable(values: Readonly<Record<string, string>> = {}) {
  const stored = new Map(Object.entries(values));
  const writes: string[] = [];
  const capabilities: HostCapabilities = {
    ...recording().capabilities,
    credential: (plugin, key) => Promise.resolve(stored.get(`${plugin}/${key}`)),
    storeCredential: (plugin, key, value) => {
      writes.push(`set ${plugin}/${key}`);
      stored.set(`${plugin}/${key}`, value);
      return Promise.resolve();
    },
    deleteCredential: (plugin, key) => {
      writes.push(`delete ${plugin}/${key}`);
      return Promise.resolve(stored.delete(`${plugin}/${key}`));
    },
  };
  return { stored, writes, capabilities };
}

describe('host.credentials.set and .delete (ADR 0134)', () => {
  it('stores, reads back and forgets a declared key', async () => {
    const { capabilities } = writable();
    const checked = checkedCapabilities('texto', ['credentials:token'], capabilities);

    await checked.storeCredential('token', 'novo');
    expect(await checked.credentials('token')).toBe('novo');
    expect(await checked.deleteCredential('token')).toBe(true);
    expect(await checked.deleteCredential('token')).toBe(false);
    expect(await codeOf(checked.credentials('token'))).toBe('E_CREDENTIAL_MISSING');
  });

  it('refuses an undeclared key with E_PERMISSION, and writes nothing', async () => {
    const { writes, capabilities } = writable({ 'texto/other': 'kept' });
    const checked = checkedCapabilities('texto', ['credentials:token'], capabilities);

    expect(await codeOf(checked.storeCredential('other', 'x'))).toBe('E_PERMISSION');
    expect(await codeOf(checked.deleteCredential('other'))).toBe('E_PERMISSION');
    await expect(checked.storeCredential('other', 'x')).rejects.toThrow(
      "Plugin 'texto' called 'host.credentials.set('other') (credentials:other)' without " +
        'that permission being granted at install time.',
    );
    expect(writes).toEqual([]);
  });

  it('stores exactly 16 KiB of UTF-8 and refuses one byte more', async () => {
    const { writes, capabilities } = writable();
    const checked = checkedCapabilities('texto', ['credentials:token'], capabilities);
    const fits = 'a'.repeat(CREDENTIAL_VALUE_LIMIT_BYTES);

    expect(CREDENTIAL_VALUE_LIMIT_BYTES).toBe(16_384);
    expect(await codeOf(checked.storeCredential('token', fits))).toBe('resolved');
    expect(await codeOf(checked.storeCredential('token', `${fits}a`))).toBe(
      'E_CREDENTIAL_TOO_LARGE',
    );
    await expect(checked.storeCredential('token', `${fits}a`)).rejects.toThrow(
      "Plugin 'texto' tried to store credential 'token' of 16385 bytes; the ceiling is 16384.",
    );
    expect(writes).toEqual(['set texto/token']);
  });

  it('counts bytes, not characters: 8,193 two-byte characters are over', async () => {
    const { capabilities } = writable();
    const checked = checkedCapabilities('texto', ['credentials:token'], capabilities);

    expect(await codeOf(checked.storeCredential('token', 'é'.repeat(8_192)))).toBe('resolved');
    expect(await codeOf(checked.storeCredential('token', 'é'.repeat(8_193)))).toBe(
      'E_CREDENTIAL_TOO_LARGE',
    );
  });

  it('refuses an empty value, which is a delete spelled wrong', async () => {
    const { writes, capabilities } = writable();
    const checked = checkedCapabilities('texto', ['credentials:token'], capabilities);

    await expect(checked.storeCredential('token', '')).rejects.toThrow(TypeError);
    expect(writes).toEqual([]);
  });

  it('answers E_CREDENTIAL_READ_ONLY on a host with no writers, naming its source', async () => {
    const { capabilities } = recording({ 'texto/token': 's3cret' });
    const checked = checkedCapabilities('texto', ['credentials:token'], capabilities);

    expect(await codeOf(checked.storeCredential('token', 'x'))).toBe('E_CREDENTIAL_READ_ONLY');
    await expect(checked.deleteCredential('token')).rejects.toThrow(
      "Plugin 'texto' tried to change credential 'token', and the variable for texto/token " +
        'is read-only here.',
    );
    expect(await checked.credentials('token')).toBe('s3cret');
  });
});

describe('the in-process host', () => {
  it('checks a built-in against its own manifest too', async () => {
    const { fetched, capabilities } = recording();
    const host = createPluginHost({ capabilities });
    let seen: Promise<string> | undefined;
    host.activate({
      id: 'svg',
      manifest: {
        name: 'svg',
        version: '1.0.0',
        engine: '>=0.1',
        contributes: ['exporter'],
        permissions: [],
      },
      activate: (inner) => {
        seen = codeOf(inner.fetch('https://api.example.com/'));
      },
    });
    expect(await seen).toBe('E_PERMISSION');
    expect(fetched).toEqual([]);
  });

  it('hands a plugin host.credentials as a function with set and delete', async () => {
    const { stored, capabilities } = writable();
    const host = createPluginHost({ capabilities });
    let seen: Promise<string> | undefined;
    host.activate({
      id: 'svg',
      manifest: {
        name: 'svg',
        version: '1.0.0',
        engine: '>=0.1',
        contributes: ['exporter'],
        permissions: ['credentials:token'],
      },
      activate: (inner) => {
        seen = (async () => {
          await inner.credentials.set('token', 'novo');
          const read = await inner.credentials('token');
          const refused = await codeOf(inner.credentials.delete('other'));
          return `${read} ${String(await inner.credentials.delete('token'))} ${refused}`;
        })();
      },
    });
    expect(await seen).toBe('novo true E_PERMISSION');
    expect([...stored]).toEqual([]);
  });
});

/**
 * A host whose cache is a map keyed `plugin/key` and whose workspace is a map of relative
 * paths, recording every call that reached it (ADR 0138).
 */
function storing() {
  const cache = new Map<string, PluginCacheEntry>();
  const files = new Map<string, Uint8Array>();
  const reached: string[] = [];
  const capabilities: HostCapabilities = {
    ...recording().capabilities,
    hostName: 'the test host',
    cacheGet: (plugin, key) => {
      reached.push(`get ${plugin}/${key}`);
      return Promise.resolve(cache.get(`${plugin}/${key}`));
    },
    cachePut: (plugin, key, bytes) => {
      reached.push(`put ${plugin}/${key}`);
      cache.set(`${plugin}/${key}`, { bytes, storedAt: '2026-10-25T12:00:00.000Z' });
      return Promise.resolve({ storedAt: '2026-10-25T12:00:00.000Z' });
    },
    cacheDelete: (plugin, key) => {
      reached.push(`delete ${plugin}/${key}`);
      return Promise.resolve(cache.delete(`${plugin}/${key}`));
    },
    cacheList: (plugin, prefix) => {
      reached.push(`list ${plugin}/${prefix}`);
      return Promise.resolve(
        [...cache]
          .filter(([name]) => name.startsWith(`${plugin}/${prefix}`))
          .map(([name, entry]) => ({
            key: name.slice(plugin.length + 1),
            storedAt: entry.storedAt,
            size: entry.bytes.length,
          })),
      );
    },
    workspaceRead: (plugin, path) => {
      reached.push(`read ${plugin} ${path}`);
      const bytes = files.get(path);
      return bytes === undefined
        ? Promise.reject(new Error('no such file'))
        : Promise.resolve(bytes);
    },
    workspaceWrite: (plugin, path, bytes) => {
      reached.push(`write ${plugin} ${path}`);
      files.set(path, bytes);
      return Promise.resolve();
    },
  };
  return { cache, files, reached, capabilities };
}

describe('host.cache (ADR 0138)', () => {
  it('needs no permission: puts, reads back, lists by prefix and forgets', async () => {
    const { capabilities } = storing();
    const checked = checkedCapabilities('texto', [], capabilities);

    expect(await checked.cachePut('jira/TYTO-1', new Uint8Array([1, 2, 3]))).toEqual({
      storedAt: '2026-10-25T12:00:00.000Z',
    });
    await checked.cachePut('google/sheet', new Uint8Array([9]));
    expect(await checked.cacheGet('jira/TYTO-1')).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      storedAt: '2026-10-25T12:00:00.000Z',
    });
    expect(await checked.cacheList('jira/')).toEqual([
      { key: 'jira/TYTO-1', storedAt: '2026-10-25T12:00:00.000Z', size: 3 },
    ]);
    expect((await checked.cacheList('')).map(({ key }) => key)).toEqual([
      'jira/TYTO-1',
      'google/sheet',
    ]);
    expect(await checked.cacheDelete('jira/TYTO-1')).toBe(true);
    expect(await checked.cacheDelete('jira/TYTO-1')).toBe(false);
    expect(await checked.cacheGet('jira/TYTO-1')).toBeUndefined();
  });

  it('keeps one plugin out of another plugin’s entries', async () => {
    const { capabilities } = storing();
    await checkedCapabilities('jira', [], capabilities).cachePut('k', new Uint8Array([1]));

    expect(await checkedCapabilities('drive', [], capabilities).cacheGet('k')).toBeUndefined();
  });

  it('refuses an empty key and one over 1 KiB of UTF-8, before the host is reached', async () => {
    const { reached, capabilities } = storing();
    const checked = checkedCapabilities('texto', [], capabilities);
    const fits = 'a'.repeat(PLUGIN_CACHE_KEY_LIMIT_BYTES);

    expect(PLUGIN_CACHE_KEY_LIMIT_BYTES).toBe(1_024);
    expect(await codeOf(checked.cacheGet(''))).toBe('E_PLUGIN_CACHE');
    await expect(checked.cachePut('', new Uint8Array())).rejects.toThrow(
      "Plugin 'texto' could not use its cache entry '': the key is empty.",
    );
    expect(await codeOf(checked.cacheGet(fits))).toBe('resolved');
    expect(await codeOf(checked.cacheDelete(`${fits}a`))).toBe('E_PLUGIN_CACHE');
    expect(await codeOf(checked.cacheList('é'.repeat(513)))).toBe('E_PLUGIN_CACHE');
    expect(reached).toEqual([`get texto/${fits}`]);
  });

  it('stores exactly 32 MiB and refuses one byte more, writing nothing', async () => {
    const { reached, capabilities } = storing();
    const checked = checkedCapabilities('texto', [], capabilities);

    expect(PLUGIN_FILE_LIMIT_BYTES).toBe(33_554_432);
    expect(await codeOf(checked.cachePut('big', new Uint8Array(PLUGIN_FILE_LIMIT_BYTES)))).toBe(
      'resolved',
    );
    await expect(
      checked.cachePut('big', new Uint8Array(PLUGIN_FILE_LIMIT_BYTES + 1)),
    ).rejects.toThrow(
      "Plugin 'texto' could not use its cache entry 'big': the entry is 33554433 bytes; " +
        'the ceiling is 33554432.',
    );
    expect(reached).toEqual(['put texto/big']);
  });

  it('refuses an entry over the ceiling that an adapter answers, too', async () => {
    const { capabilities } = storing();
    const checked = checkedCapabilities('texto', [], {
      ...capabilities,
      cacheGet: () =>
        Promise.resolve({ bytes: new Uint8Array(PLUGIN_FILE_LIMIT_BYTES + 1), storedAt: 'x' }),
    });

    expect(await codeOf(checked.cacheGet('big'))).toBe('E_PLUGIN_CACHE');
  });

  it('answers E_PLUGIN_CACHE on a host with no cache, naming the host', async () => {
    const named = checkedCapabilities('texto', [], {
      ...recording().capabilities,
      hostName: 'tyto',
    });
    const unnamed = checkedCapabilities('texto', [], undefined);

    await expect(named.cacheGet('k')).rejects.toThrow(
      "Plugin 'texto' could not use its cache entry 'k': tyto keeps no cache for plugins.",
    );
    expect(await codeOf(named.cachePut('k', new Uint8Array([1])))).toBe('E_PLUGIN_CACHE');
    expect(await codeOf(named.cacheDelete('k'))).toBe('E_PLUGIN_CACHE');
    await expect(unnamed.cacheList('')).rejects.toThrow('this host keeps no cache for plugins.');
  });
});

describe('host.workspace (ADR 0138)', () => {
  it('reads and writes with workspace:read and workspace:write', async () => {
    const { files, capabilities } = storing();
    const checked = checkedCapabilities(
      'texto',
      ['workspace:read', 'workspace:write'],
      capabilities,
    );

    await checked.workspaceWrite('tabelas/jira.csv', new Uint8Array([7]));
    expect(await checked.workspaceRead('tabelas/jira.csv')).toEqual(new Uint8Array([7]));
    expect([...files.keys()]).toEqual(['tabelas/jira.csv']);
  });

  it('refuses each access the manifest did not declare, and reaches nothing', async () => {
    const { reached, capabilities } = storing();
    const reader = checkedCapabilities('texto', ['workspace:read'], capabilities);
    const writer = checkedCapabilities('texto', ['workspace:write'], capabilities);

    await expect(reader.workspaceWrite('a.csv', new Uint8Array([1]))).rejects.toThrow(
      "Plugin 'texto' called 'host.workspace.write('a.csv') (workspace:write)' without that " +
        'permission being granted at install time.',
    );
    expect(await codeOf(writer.workspaceRead('a.csv'))).toBe('E_PERMISSION');
    expect(reached).toEqual([]);
  });

  it.each([
    ['', 'the path is empty'],
    ['/etc/passwd', 'the path is absolute; it must be relative to the open folder'],
    ['C:\\Windows\\win.ini', 'the path is absolute; it must be relative to the open folder'],
    ['\\\\server\\share\\x', 'the path is absolute; it must be relative to the open folder'],
    ['a/../../fora.txt', 'the path leaves the folder'],
    ['a\\..\\..\\fora.txt', 'the path leaves the folder'],
    ['./', 'the path names the folder itself'],
    ['a\u0000b', 'the path holds a control character'],
    ['.tyto/project.json', 'it is inside .tyto/, which only Tyto writes'],
    ['./.TYTO/trust.json', 'it is inside .tyto/, which only Tyto writes'],
    ['.tyto. /x', 'it is inside .tyto/, which only Tyto writes'],
  ])('refuses writing %j lexically: %s', async (path, problem) => {
    const { reached, capabilities } = storing();
    const checked = checkedCapabilities('texto', ['workspace:write'], capabilities);

    await expect(checked.workspaceWrite(path, new Uint8Array([1]))).rejects.toThrow(
      `Plugin 'texto' could not use workspace file '${path}': ${problem}.`,
    );
    expect(reached).toEqual([]);
  });

  it('hands the adapter a cleaned path, and lets a read into .tyto/ through', () => {
    expect(workspacePath('./tabelas\\\\jira.csv', 'write')).toBe('tabelas/jira.csv');
    expect(workspacePath('.tyto/project.json', 'read')).toBe('.tyto/project.json');
    expect(workspacePath('.tytox/a', 'write')).toBe('.tytox/a');
  });

  it('writes exactly 32 MiB and refuses one byte more; a read over it is refused', async () => {
    const { reached, capabilities } = storing();
    const checked = checkedCapabilities('texto', ['workspace:read', 'workspace:write'], {
      ...capabilities,
      workspaceRead: () => Promise.resolve(new Uint8Array(PLUGIN_FILE_LIMIT_BYTES + 1)),
    });

    expect(
      await codeOf(checked.workspaceWrite('a.bin', new Uint8Array(PLUGIN_FILE_LIMIT_BYTES))),
    ).toBe('resolved');
    await expect(
      checked.workspaceWrite('a.bin', new Uint8Array(PLUGIN_FILE_LIMIT_BYTES + 1)),
    ).rejects.toThrow('the file is 33554433 bytes; the ceiling is 33554432.');
    expect(await codeOf(checked.workspaceRead('a.bin'))).toBe('E_WORKSPACE_FILE');
    expect(reached).toEqual(['write texto a.bin']);
  });

  it('answers E_WORKSPACE_FILE on a host with no workspace, naming the host', async () => {
    const checked = checkedCapabilities('texto', ['workspace:read', 'workspace:write'], {
      ...recording().capabilities,
      hostName: 'tyto watch',
    });

    await expect(checked.workspaceRead('a.csv')).rejects.toThrow(
      "Plugin 'texto' could not use workspace file 'a.csv': tyto watch gives plugins no " +
        'workspace files.',
    );
    expect(await codeOf(checked.workspaceWrite('a.csv', new Uint8Array([1])))).toBe(
      'E_WORKSPACE_FILE',
    );
  });

  it('passes the adapter’s restricted refusal through untouched', async () => {
    const { capabilities } = storing();
    const checked = checkedCapabilities('texto', ['workspace:write'], {
      ...capabilities,
      workspaceWrite: () =>
        Promise.reject(
          new PluginCapabilityError(
            diagnostic('E_WORKSPACE_FILE_RESTRICTED', { plugin: 'texto', path: 'a.csv' }),
          ),
        ),
    });

    expect(await codeOf(checked.workspaceWrite('a.csv', new Uint8Array([1])))).toBe(
      'E_WORKSPACE_FILE_RESTRICTED',
    );
  });
});

describe('host.cache and host.workspace in process', () => {
  it('hands a plugin both, taking a string as UTF-8, and write resolves to null', async () => {
    const { files, capabilities } = storing();
    const host = createPluginHost({ capabilities });
    let seen: Promise<string> | undefined;
    host.activate({
      id: 'svg',
      manifest: {
        name: 'svg',
        version: '1.0.0',
        engine: '>=0.1',
        contributes: ['exporter'],
        permissions: ['workspace:write'],
      },
      activate: (inner) => {
        seen = (async () => {
          const { storedAt } = await inner.cache.put('k', 'olá');
          const entry = await inner.cache.get('k');
          const listed = await inner.cache.list();
          const written = await inner.workspace.write('saida.txt', 'oi');
          const refused = await codeOf(inner.workspace.read('saida.txt'));
          return [
            storedAt,
            String(entry?.bytes.length),
            listed.map(({ key, size }) => `${key}:${String(size)}`).join(','),
            String(written),
            refused,
          ].join(' ');
        })();
      },
    });

    expect(await seen).toBe('2026-10-25T12:00:00.000Z 4 k:4 null E_PERMISSION');
    expect(files.get('saida.txt')).toEqual(new Uint8Array([111, 105]));
  });
});
