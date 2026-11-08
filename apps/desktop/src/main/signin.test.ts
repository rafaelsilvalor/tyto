import { createHash } from 'node:crypto';
import { get } from 'node:http';

import { type SigninDeclaration, checkedCapabilities } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

import type { Credentials } from './credentials.js';
import { desktopCapabilities } from './installed-plugins.js';
import type { TokenFetch } from './oauth.js';
import {
  DEFAULT_SIGNIN_LABEL,
  type SigninService,
  createSigninService,
  installedSigninDeclarations,
  signinAccount,
  signinCapabilities,
} from './signin.js';

/**
 * The sign-in service end to end in main, with the real loopback listener and a fake
 * provider: the "browser" follows the authorize URL straight to the callback, and the token
 * endpoint enforces PKCE the way a provider does. The keychain is a map — never the real one.
 */

const declaration: SigninDeclaration = {
  authorize: 'https://auth.example.test/authorize',
  token: 'https://auth.example.test/token',
  clientId: 'client-1',
  scopes: ['files'],
};

const idToken = (claims: object): string =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

/** The keychain, in plaintext: what `credentials.set` was handed is what a test reads. */
function keychain(): Pick<Credentials, 'get' | 'set' | 'delete'> & {
  entries: Map<string, string>;
} {
  const entries = new Map<string, string>();
  return {
    entries,
    get: (account) => Promise.resolve(entries.get(account) ?? null),
    set: (account, secret) => {
      entries.set(account, secret);
      return Promise.resolve();
    },
    delete: (account) => Promise.resolve(entries.delete(account)),
  };
}

interface Provider {
  readonly fetch: TokenFetch;
  /** Every grant the token endpoint received, in order. */
  readonly grants: URLSearchParams[];
  challenge: string | undefined;
  /** What the next refresh answers. */
  refreshAnswer: { status: number; body: object };
  codeAnswer: object;
}

function provider(): Provider {
  const state: Provider = {
    grants: [],
    challenge: undefined,
    refreshAnswer: { status: 200, body: { access_token: 'access-2', expires_in: 3600 } },
    codeAnswer: {
      access_token: 'access-1',
      expires_in: 3600,
      refresh_token: 'refresh-1',
      id_token: idToken({ email: 'person@example.test' }),
    },
    fetch: (_url, init) => {
      const grant = new URLSearchParams(init.body);
      state.grants.push(grant);
      const answer = (status: number, body: object) =>
        Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(body)) });
      if (grant.get('grant_type') === 'authorization_code') {
        // What a provider checks (RFC 7636 section 4.6): the verifier hashes to the challenge.
        const verifier = grant.get('code_verifier') ?? '';
        const hashed = createHash('sha256').update(verifier).digest('base64url');
        if (grant.get('code') !== 'code-1' || hashed !== state.challenge) {
          return answer(400, { error: 'invalid_grant', error_description: 'verifier mismatch' });
        }
        return answer(200, state.codeAnswer);
      }
      return answer(state.refreshAnswer.status, state.refreshAnswer.body);
    },
  };
  return state;
}

interface Rig {
  readonly service: SigninService;
  readonly keys: ReturnType<typeof keychain>;
  readonly provider: Provider;
  readonly clock: { now: number };
}

/** `callbackState` stands in for a callback that came from somewhere else. */
function rig(options: { callbackState?: string } = {}): Rig {
  const keys = keychain();
  const fake = provider();
  const clock = { now: Date.parse('2026-11-08T12:00:00.000Z') };
  const service = createSigninService({
    credentials: keys,
    declarationOf: (plugin, id) =>
      Promise.resolve(plugin === 'drive-plugin' && id === 'drive' ? declaration : undefined),
    fetch: fake.fetch,
    now: () => clock.now,
    openBrowser: async (url) => {
      const authorize = new URL(url);
      fake.challenge = authorize.searchParams.get('code_challenge') ?? undefined;
      const callback = new URL(authorize.searchParams.get('redirect_uri') ?? '');
      callback.searchParams.set('code', 'code-1');
      callback.searchParams.set(
        'state',
        options.callbackState ?? authorize.searchParams.get('state') ?? '',
      );
      // The browser following the redirect to the loopback listener.
      await new Promise<void>((resolve, reject) => {
        get(callback, (response) => {
          response.resume();
          response.on('end', resolve);
        }).on('error', reject);
      });
    },
  });
  return { service, keys, provider: fake, clock };
}

const ACCOUNT = signinAccount('drive-plugin', 'drive');

describe('start', () => {
  it('signs in, keeps only the refresh token in the keychain and the access token in memory', async () => {
    const { service, keys, provider: fake } = rig();

    const outcome = await service.start('drive-plugin', 'drive');

    expect(outcome).toEqual({
      ok: true,
      label: 'person@example.test',
      since: '2026-11-08T12:00:00.000Z',
    });
    expect([...keys.entries.keys()]).toEqual(['signin:drive-plugin:drive']);
    expect(JSON.parse(keys.entries.get(ACCOUNT) ?? '')).toEqual({
      refresh: 'refresh-1',
      label: 'person@example.test',
      since: '2026-11-08T12:00:00.000Z',
    });
    expect(keys.entries.get(ACCOUNT)).not.toContain('access-1');
    expect(await service.accessToken('drive-plugin', 'drive')).toBe('access-1');
    // Answered from memory: the token endpoint heard only the code exchange.
    expect(fake.grants.map((grant) => grant.get('grant_type'))).toEqual(['authorization_code']);
  });

  it('says "Signed in" when the provider sends no id_token', async () => {
    const { service, provider: fake } = rig();
    fake.codeAnswer = { access_token: 'access-1', refresh_token: 'refresh-1' };

    const outcome = await service.start('drive-plugin', 'drive');

    expect(outcome).toMatchObject({ ok: true, label: DEFAULT_SIGNIN_LABEL });
    expect(await service.status('drive-plugin', 'drive')).toEqual({
      label: DEFAULT_SIGNIN_LABEL,
      since: '2026-11-08T12:00:00.000Z',
    });
  });

  it('refuses a callback carrying another state, and trades nothing', async () => {
    const { service, keys, provider: fake } = rig({ callbackState: 'planted' });

    const outcome = await service.start('drive-plugin', 'drive');

    expect(outcome).toMatchObject({ ok: false, reason: 'state-mismatch' });
    expect(fake.grants).toEqual([]);
    expect(keys.entries.size).toBe(0);
  });

  it('stores nothing when the provider sends no refresh token', async () => {
    const { service, keys, provider: fake } = rig();
    fake.codeAnswer = { access_token: 'access-1' };

    expect(await service.start('drive-plugin', 'drive')).toMatchObject({
      ok: false,
      reason: 'no-refresh-token',
    });
    expect(keys.entries.size).toBe(0);
  });

  it('refuses a sign-in the plugin does not declare, without opening a browser', async () => {
    const { service, provider: fake } = rig();

    expect(await service.start('drive-plugin', 'other')).toMatchObject({
      ok: false,
      reason: 'undeclared',
    });
    expect(fake.challenge).toBeUndefined();
  });
});

describe('accessToken', () => {
  it('answers nothing, and asks no provider, when nobody signed in', async () => {
    const { service, provider: fake } = rig();

    expect(await service.accessToken('drive-plugin', 'drive')).toBeUndefined();
    expect(fake.grants).toEqual([]);
  });

  it('refreshes once the injected clock passes the expiry, and keeps a rotated token', async () => {
    const { service, keys, provider: fake, clock } = rig();
    await service.start('drive-plugin', 'drive');
    fake.refreshAnswer = {
      status: 200,
      body: { access_token: 'access-2', expires_in: 3600, refresh_token: 'refresh-2' },
    };

    clock.now += 3600 * 1000 - 61 * 1000;
    expect(await service.accessToken('drive-plugin', 'drive')).toBe('access-1');
    clock.now += 2 * 1000;
    expect(await service.accessToken('drive-plugin', 'drive')).toBe('access-2');

    expect(fake.grants[1]?.get('refresh_token')).toBe('refresh-1');
    expect(JSON.parse(keys.entries.get(ACCOUNT) ?? '')).toMatchObject({
      refresh: 'refresh-2',
      label: 'person@example.test',
    });
  });

  it('spends the refresh token once when two calls arrive at expiry', async () => {
    const { service, provider: fake, clock } = rig();
    await service.start('drive-plugin', 'drive');
    clock.now += 2 * 3600 * 1000;

    const answers = await Promise.all([
      service.accessToken('drive-plugin', 'drive'),
      service.accessToken('drive-plugin', 'drive'),
    ]);

    expect(answers).toEqual(['access-2', 'access-2']);
    expect(fake.grants.filter((grant) => grant.get('grant_type') === 'refresh_token')).toHaveLength(
      1,
    );
  });

  it('deletes the entry when the refresh is answered invalid_grant', async () => {
    const { service, keys, provider: fake, clock } = rig();
    await service.start('drive-plugin', 'drive');
    fake.refreshAnswer = { status: 400, body: { error: 'invalid_grant' } };
    clock.now += 2 * 3600 * 1000;

    expect(await service.accessToken('drive-plugin', 'drive')).toBeUndefined();

    expect(keys.entries.has(ACCOUNT)).toBe(false);
    expect(await service.status('drive-plugin', 'drive')).toBeUndefined();
  });

  it('keeps the entry and says why when the refresh fails for another reason', async () => {
    const { service, keys, provider: fake, clock } = rig();
    await service.start('drive-plugin', 'drive');
    fake.refreshAnswer = { status: 503, body: { error: 'temporarily_unavailable' } };
    clock.now += 2 * 3600 * 1000;

    await expect(service.accessToken('drive-plugin', 'drive')).rejects.toThrow(
      /temporarily_unavailable/u,
    );
    expect(keys.entries.has(ACCOUNT)).toBe(true);
  });
});

describe('signOut', () => {
  it('deletes the entry and forgets the access token', async () => {
    const { service, keys, provider: fake } = rig();
    await service.start('drive-plugin', 'drive');

    expect(await service.signOut('drive-plugin', 'drive')).toBe(true);

    expect(keys.entries.size).toBe(0);
    expect(await service.accessToken('drive-plugin', 'drive')).toBeUndefined();
    expect(fake.grants).toHaveLength(1);
  });
});

describe('what a plugin reaches', () => {
  const PERMISSIONS = ['signin:drive'];
  const noNetwork = () => Promise.reject(new Error('no network in this test'));
  /** The desktop's composition, as `index.ts` spreads it. */
  const composed = (service: SigninService, keys: ReturnType<typeof keychain>) =>
    checkedCapabilities('drive-plugin', PERMISSIONS, {
      ...desktopCapabilities(keys, noNetwork),
      ...signinCapabilities(service),
    });

  it('gets the access token and nothing that holds the refresh token', async () => {
    const { service, keys } = rig();
    await service.start('drive-plugin', 'drive');
    const checked = composed(service, keys);

    const token = await checked.signinAccessToken('drive');

    expect(token).toBe('access-1');
    expect(JSON.stringify(token)).not.toContain('refresh-1');
    // Its own credentials never reach the sign-in's entry, whatever it names.
    await expect(checked.credentials(ACCOUNT)).rejects.toMatchObject({ code: 'E_PERMISSION' });
    expect(keys.entries.has(ACCOUNT)).toBe(true);
  });

  it('is told to sign in when nobody has, and refused an id it does not declare', async () => {
    const { service, keys } = rig();
    const checked = composed(service, keys);

    await expect(checked.signinAccessToken('drive')).rejects.toMatchObject({
      code: 'E_SIGNIN_REQUIRED',
    });
    await expect(checked.signinAccessToken('other')).rejects.toMatchObject({
      code: 'E_PERMISSION',
    });
  });
});

describe('installedSigninDeclarations', () => {
  const manifest = JSON.stringify({
    name: 'drive-plugin',
    version: '1.0.0',
    engine: '>=0.1',
    contributes: ['template-pack'],
    permissions: ['signin:drive'],
    signin: { drive: declaration },
  });

  it("reads the installed manifest's entry, and nothing for another id or plugin", async () => {
    const declarations = installedSigninDeclarations({
      list: () => Promise.resolve([{ folder: 'drive-plugin', manifestSource: manifest }]),
    });

    expect(await declarations('drive-plugin', 'drive')).toEqual(declaration);
    expect(await declarations('drive-plugin', 'other')).toBeUndefined();
    expect(await declarations('somebody-else', 'drive')).toBeUndefined();
  });
});
