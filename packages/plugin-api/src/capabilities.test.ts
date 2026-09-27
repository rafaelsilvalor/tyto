import { describe, expect, it } from 'vitest';

import {
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
});
