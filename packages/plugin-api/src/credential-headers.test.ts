import { describe, expect, it } from 'vitest';

import {
  type FetchedResponse,
  type HostCapabilities,
  type HostFetchInit,
  PluginCapabilityError,
  checkedCapabilities,
  namesHost,
} from './capabilities.js';

/**
 * A credential the host puts in a request's header, so the plugin never holds it (ADR 0191). The
 * secret below is a probe: every assertion that it is absent is the point of the test.
 */

const SECRET = 'sk-probe-7f3a91c2';
const ANSWER: FetchedResponse = {
  url: 'https://api.example.com/v1/messages',
  status: 200,
  statusText: 'OK',
  headers: {},
  body: new Uint8Array(),
};

function host(overrides: Partial<HostCapabilities> = {}) {
  const sent: { url: string; init: HostFetchInit }[] = [];
  const capabilities: HostCapabilities = {
    hostName: 'the test host',
    fetch: (url, init) => {
      sent.push({ url, init });
      return Promise.resolve(ANSWER);
    },
    credential: (_plugin, key) => Promise.resolve(key === 'api-key' ? SECRET : undefined),
    describeCredential: () => 'the test keychain',
    ...overrides,
  };
  return { capabilities, sent };
}

const DECLARED = ['net:api.example.com', 'credentials:api-key'];

const outcome = (attempt: Promise<unknown>): Promise<string> =>
  attempt.then(
    () => 'answered',
    (cause: unknown) =>
      cause instanceof PluginCapabilityError
        ? cause.code
        : `thrown: ${cause instanceof Error ? cause.message : String(cause)}`,
  );

describe('which hosts a credential may be sent to', () => {
  it('is a host a net: permission names, exactly or under *.<domain>, never through net:*', () => {
    expect(namesHost(['net:api.example.com'], 'api.example.com')).toBe(true);
    expect(namesHost(['net:API.example.com'], 'api.example.com')).toBe(true);
    expect(namesHost(['net:*.example.com'], 'api.example.com')).toBe(true);
    expect(namesHost(['net:*'], 'api.example.com')).toBe(false);
    expect(namesHost(['net:example.com'], 'api.example.com')).toBe(false);
    expect(namesHost(['credentials:api-key'], 'api.example.com')).toBe(false);
  });
});

describe('host.fetch with credentialHeaders', () => {
  it('sets the header from the credential, and passes no credentialHeaders on', async () => {
    const { capabilities, sent } = host();
    await checkedCapabilities('agent', DECLARED, capabilities).fetch(
      'https://api.example.com/v1/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentialHeaders: { 'x-api-key': 'api-key' },
      },
    );
    expect(sent).toEqual([
      {
        url: 'https://api.example.com/v1/messages',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': SECRET },
        },
      },
    ]);
  });

  it('refuses a host no net: permission of its own names, before reading the secret', async () => {
    let read = 0;
    const { capabilities, sent } = host({
      credential: () => {
        read += 1;
        return Promise.resolve(SECRET);
      },
    });
    const wide = checkedCapabilities('agent', ['net:*', 'credentials:api-key'], capabilities);
    expect(
      await outcome(
        wide.fetch('https://elsewhere.example.org/', {
          credentialHeaders: { 'x-api-key': 'api-key' },
        }),
      ),
    ).toBe('E_CREDENTIAL_HOST');
    const narrow = checkedCapabilities(
      'agent',
      ['net:api.example.com', 'net:elsewhere.example.org', 'credentials:api-key'],
      capabilities,
    );
    // A subdomain no permission names: the request itself is refused, before any credential.
    expect(
      await outcome(
        narrow.fetch('https://evil.api.example.com/', {
          credentialHeaders: { 'x-api-key': 'api-key' },
        }),
      ),
    ).toBe('E_PERMISSION');
    expect(read).toBe(0);
    expect(sent).toEqual([]);
  });

  it('refuses an undeclared key, a clash with a plain header and a bad header name', async () => {
    const { capabilities, sent } = host();
    const checked = checkedCapabilities('agent', DECLARED, capabilities);
    const url = 'https://api.example.com/';
    expect(await outcome(checked.fetch(url, { credentialHeaders: { 'x-api-key': 'other' } }))).toBe(
      'E_PERMISSION',
    );
    expect(
      await outcome(
        checked.fetch(url, {
          headers: { 'X-Api-Key': 'mine' },
          credentialHeaders: { 'x-api-key': 'api-key' },
        }),
      ),
    ).toMatch(/both as a header and as a credential header/u);
    expect(
      await outcome(checked.fetch(url, { credentialHeaders: { 'x api key': 'api-key' } })),
    ).toMatch(/not a header name/u);
    expect(sent).toEqual([]);
  });

  it('answers E_CREDENTIAL_MISSING when the person has not stored the key', async () => {
    const { capabilities } = host({ credential: () => Promise.resolve(undefined) });
    expect(
      await outcome(
        checkedCapabilities('agent', DECLARED, capabilities).fetch('https://api.example.com/', {
          credentialHeaders: { 'x-api-key': 'api-key' },
        }),
      ),
    ).toBe('E_CREDENTIAL_MISSING');
  });

  it('never hands the secret back in an error, even from an adapter that quotes it', async () => {
    const { capabilities } = host({
      fetch: (_url, init) =>
        Promise.reject(new Error(`refused request with x-api-key=${init.headers?.['x-api-key']}`)),
    });
    const answer = await checkedCapabilities('agent', DECLARED, capabilities)
      .fetch('https://api.example.com/', { credentialHeaders: { 'x-api-key': 'api-key' } })
      .then(
        () => 'answered',
        (cause: Error) => `${cause.message}\n${cause.stack ?? ''}`,
      );
    expect(answer).toContain('x-api-key=[credential]');
    expect(answer).not.toContain(SECRET);
  });
});
