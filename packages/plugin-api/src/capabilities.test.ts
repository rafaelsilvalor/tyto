import { describe, expect, it } from 'vitest';

import {
  CREDENTIAL_VALUE_LIMIT_BYTES,
  type FetchedResponse,
  type HostCapabilities,
  PluginCapabilityError,
  allowsHost,
  checkedCapabilities,
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
