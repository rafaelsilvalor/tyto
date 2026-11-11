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
  listSignins,
  signinAccount,
  signinCallbackPage,
  signinClientAccount,
  signinCapabilities,
  signinWindow,
} from './signin.js';
import type { CallbackPage } from './loopback.js';
import { translate } from '../../shared/i18n/index.js';

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
function keychain(): Pick<Credentials, 'get' | 'has' | 'set' | 'delete'> & {
  entries: Map<string, string>;
} {
  const entries = new Map<string, string>();
  return {
    entries,
    get: (account) => Promise.resolve(entries.get(account) ?? null),
    has: (account) => Promise.resolve(entries.has(account)),
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
  /** The `client_id` the last authorize URL carried. */
  authorizedClient: string | undefined;
  /** What the next refresh answers. */
  refreshAnswer: { status: number; body: object };
  codeAnswer: object;
}

function provider(): Provider {
  const state: Provider = {
    grants: [],
    challenge: undefined,
    authorizedClient: undefined,
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
function rig(
  options: {
    callbackState?: string;
    onChanged?: () => void;
    callbackPage?: () => CallbackPage;
    /** Where the "browser" puts the landing page it was answered. */
    landed?: string[];
    /** The `drive` entry the installed manifest declares; `declaration` when absent. */
    entry?: SigninDeclaration;
  } = {},
): Rig {
  const keys = keychain();
  const fake = provider();
  const clock = { now: Date.parse('2026-11-08T12:00:00.000Z') };
  const service = createSigninService({
    credentials: keys,
    declarationOf: (plugin, id) =>
      Promise.resolve(
        plugin === 'drive-plugin' && id === 'drive' ? (options.entry ?? declaration) : undefined,
      ),
    fetch: fake.fetch,
    now: () => clock.now,
    ...(options.onChanged === undefined ? {} : { onChanged: options.onChanged }),
    ...(options.callbackPage === undefined ? {} : { callbackPage: options.callbackPage }),
    openBrowser: async (url) => {
      const authorize = new URL(url);
      fake.challenge = authorize.searchParams.get('code_challenge') ?? undefined;
      fake.authorizedClient = authorize.searchParams.get('client_id') ?? undefined;
      const callback = new URL(authorize.searchParams.get('redirect_uri') ?? '');
      callback.searchParams.set('code', 'code-1');
      callback.searchParams.set(
        'state',
        options.callbackState ?? authorize.searchParams.get('state') ?? '',
      );
      // The browser following the redirect to the loopback listener.
      await new Promise<void>((resolve, reject) => {
        get(callback, (response) => {
          let page = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => (page += chunk));
          response.on('end', () => {
            options.landed?.push(page);
            resolve();
          });
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

describe('the window side (TYTO-374)', () => {
  const manifest = (name: string, ids: readonly string[]): string =>
    JSON.stringify({
      name,
      version: '1.0.0',
      engine: '>=0.1',
      contributes: ['template-pack'],
      permissions: ids.map((id) => `signin:${id}`),
      ...(ids.length === 0
        ? {}
        : { signin: Object.fromEntries(ids.map((id) => [id, declaration])) }),
    });
  const store = {
    list: () =>
      Promise.resolve([
        { folder: 'drive-plugin', manifestSource: manifest('drive-plugin', ['drive']) },
        { folder: 'plain', manifestSource: manifest('plain', []) },
        { folder: 'broken', manifestSource: '{ not json' },
        { folder: 'empty', manifestSource: undefined },
      ]),
  };

  it('lists every declared sign-in with who is signed in, and never a token', async () => {
    const { service } = rig();
    expect(await listSignins(store, service)).toEqual([
      { plugin: 'drive-plugin', id: 'drive', signedIn: false, client: 'manifest' },
    ]);

    await service.start('drive-plugin', 'drive');
    const rows = await listSignins(store, service);

    expect(rows).toEqual([
      {
        plugin: 'drive-plugin',
        id: 'drive',
        signedIn: true,
        label: 'person@example.test',
        since: '2026-11-08T12:00:00.000Z',
        client: 'manifest',
      },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/refresh-1|access-1/u);
  });

  it('leaves the English default label out, so the window says it in its own words', async () => {
    const { service, provider: fake } = rig();
    fake.codeAnswer = { access_token: 'access-1', refresh_token: 'refresh-1' };
    await service.start('drive-plugin', 'drive');

    expect(await listSignins(store, service)).toEqual([
      {
        plugin: 'drive-plugin',
        id: 'drive',
        signedIn: true,
        since: '2026-11-08T12:00:00.000Z',
        client: 'manifest',
      },
    ]);
  });

  it('rejects a plugin or id nobody declares, before anything runs or is deleted', async () => {
    const { service, keys, provider: fake } = rig();
    keys.entries.set(signinAccount('plain', 'drive'), 'kept');
    const window = signinWindow(store, service);

    await expect(window.start('drive-plugin', 'other')).rejects.toThrow(TypeError);
    await expect(window.out('plain', 'drive')).rejects.toThrow(
      "No installed plugin 'plain' declares the sign-in 'drive'",
    );
    expect(fake.challenge).toBeUndefined();
    expect(keys.entries.get(signinAccount('plain', 'drive'))).toBe('kept');
  });

  it('signs in and out, and answers whether it worked with no token in the answer', async () => {
    const { service, keys } = rig();
    const window = signinWindow(store, service);

    expect(await window.start('drive-plugin', 'drive')).toEqual({ ok: true });
    expect(keys.entries.has(ACCOUNT)).toBe(true);
    expect(await window.out('drive-plugin', 'drive')).toEqual({ signedOut: true });
    expect(keys.entries.has(ACCOUNT)).toBe(false);
    expect(await window.out('drive-plugin', 'drive')).toEqual({ signedOut: false });
  });

  it('answers failed with the message when the keychain refuses to store', async () => {
    const { service, keys } = rig();
    keys.set = () => Promise.reject(new Error('Encryption is not available on this machine'));

    expect(await signinWindow(store, service).start('drive-plugin', 'drive')).toEqual({
      ok: false,
      reason: 'failed',
      message: 'Encryption is not available on this machine',
    });
  });

  it('tells the window after a sign-in, a sign-out and an invalid_grant, not after a no-op', async () => {
    let told = 0;
    const { service, provider: fake, clock } = rig({ onChanged: () => (told += 1) });

    await service.start('drive-plugin', 'drive');
    expect(told).toBe(1);
    clock.now += 2 * 3600 * 1000;
    fake.refreshAnswer = { status: 400, body: { error: 'invalid_grant' } };
    await service.accessToken('drive-plugin', 'drive');
    expect(told).toBe(2);
    await service.start('drive-plugin', 'drive');
    await service.signOut('drive-plugin', 'drive');
    await service.signOut('drive-plugin', 'drive');
    expect(told).toBe(4);
  });

  it("lands the browser on a page in the window's language", async () => {
    const landed: string[] = [];
    const { service } = rig({
      landed,
      callbackPage: () => signinCallbackPage((key) => translate('pt-BR', key), 'pt-BR'),
    });

    await service.start('drive-plugin', 'drive');

    expect(landed[0]).toContain('<html lang="pt-BR">');
    expect(landed[0]).toContain(translate('pt-BR', 'plugins.signin.page.signedIn'));
    expect(landed[0]).toContain(translate('pt-BR', 'plugins.signin.page.close'));
  });
});

describe('a client the person supplies (ADR 0192)', () => {
  const { clientId: _manifestClient, ...withoutClient } = declaration;
  const CLIENT_ACCOUNT = signinClientAccount('drive-plugin', 'drive');
  const PERSON = { clientId: 'person-client', clientSecret: 'person-secret' };
  const manifest = (entry: SigninDeclaration): string =>
    JSON.stringify({
      name: 'drive-plugin',
      version: '1.0.0',
      engine: '>=0.1',
      contributes: ['template-pack'],
      permissions: ['signin:drive'],
      signin: { drive: entry },
    });
  const storeOf = (entry: SigninDeclaration) => ({
    list: () => Promise.resolve([{ folder: 'drive-plugin', manifestSource: manifest(entry) }]),
  });

  it('answers no-client, and opens no browser, until a client is set', async () => {
    const { service, provider: fake } = rig({ entry: withoutClient });

    expect(await service.start('drive-plugin', 'drive')).toMatchObject({
      ok: false,
      reason: 'no-client',
    });
    expect(fake.challenge).toBeUndefined();
    expect(await service.accessToken('drive-plugin', 'drive')).toBeUndefined();
  });

  it('signs in with the stored client and secret, and refreshes with them', async () => {
    const { service, keys, provider: fake, clock } = rig({ entry: withoutClient });
    await service.setClient('drive-plugin', 'drive', PERSON);

    expect(await service.start('drive-plugin', 'drive')).toMatchObject({ ok: true });
    expect(fake.authorizedClient).toBe('person-client');
    expect(fake.grants[0]?.get('client_id')).toBe('person-client');
    expect(fake.grants[0]?.get('client_secret')).toBe('person-secret');
    expect(JSON.parse(keys.entries.get(CLIENT_ACCOUNT) ?? '')).toEqual(PERSON);

    clock.now += 2 * 3600 * 1000;
    expect(await service.accessToken('drive-plugin', 'drive')).toBe('access-2');
    expect(fake.grants[1]?.get('grant_type')).toBe('refresh_token');
    expect(fake.grants[1]?.get('client_id')).toBe('person-client');
    expect(fake.grants[1]?.get('client_secret')).toBe('person-secret');
  });

  it('ends the sign-in made with the previous client when another is set or it is cleared', async () => {
    let told = 0;
    const {
      service,
      keys,
      provider: fake,
    } = rig({
      entry: withoutClient,
      onChanged: () => (told += 1),
    });
    await service.setClient('drive-plugin', 'drive', PERSON);
    await service.start('drive-plugin', 'drive');
    expect(await service.accessToken('drive-plugin', 'drive')).toBe('access-1');

    await service.setClient('drive-plugin', 'drive', { clientId: 'another-client' });

    expect(keys.entries.has(ACCOUNT)).toBe(false);
    expect(await service.accessToken('drive-plugin', 'drive')).toBeUndefined();
    expect(JSON.parse(keys.entries.get(CLIENT_ACCOUNT) ?? '')).toEqual({
      clientId: 'another-client',
    });

    await service.start('drive-plugin', 'drive');
    expect(keys.entries.has(ACCOUNT)).toBe(true);
    expect(await service.clearClient('drive-plugin', 'drive')).toBe(true);
    expect([...keys.entries.keys()]).toEqual([]);
    expect(await service.accessToken('drive-plugin', 'drive')).toBeUndefined();
    expect(await service.clearClient('drive-plugin', 'drive')).toBe(false);
    // Two sets, two sign-ins and one clear; the clear that found nothing told nobody.
    expect(told).toBe(5);
    expect(fake.grants.filter((grant) => grant.get('grant_type') === 'refresh_token')).toEqual([]);
  });

  it("uses the manifest's client when it declares one, whatever the keychain holds", async () => {
    const { service, keys, provider: fake } = rig();
    keys.entries.set(CLIENT_ACCOUNT, JSON.stringify(PERSON));

    await service.start('drive-plugin', 'drive');

    expect(fake.authorizedClient).toBe('client-1');
    expect(fake.grants[0]?.get('client_id')).toBe('client-1');
    expect(fake.grants[0]?.has('client_secret')).toBe(false);
  });

  it('refuses a client for a manifest that names its own, and for a sign-in nobody declares', async () => {
    const { service, keys } = rig();

    await expect(service.setClient('drive-plugin', 'drive', PERSON)).rejects.toThrow(
      "drive-plugin declares the client of its sign-in 'drive' itself",
    );
    await expect(service.clearClient('drive-plugin', 'drive')).rejects.toThrow(TypeError);
    await expect(service.setClient('drive-plugin', 'other', PERSON)).rejects.toThrow(
      "drive-plugin declares no sign-in 'other'",
    );
    expect(keys.entries.size).toBe(0);
  });

  it('lists where the client comes from and never the client', async () => {
    const { service } = rig({ entry: withoutClient });
    const store = storeOf(withoutClient);

    expect(await listSignins(store, service)).toEqual([
      { plugin: 'drive-plugin', id: 'drive', signedIn: false, client: 'missing' },
    ]);
    await service.setClient('drive-plugin', 'drive', PERSON);
    const rows = await listSignins(store, service);

    expect(rows).toEqual([{ plugin: 'drive-plugin', id: 'drive', signedIn: false, client: 'set' }]);
    expect(JSON.stringify(rows)).not.toMatch(/person-client|person-secret/u);
  });

  it('stores and clears through the window, answering without the client', async () => {
    const { service, keys } = rig({ entry: withoutClient });
    const window = signinWindow(storeOf(withoutClient), service);

    const stored = await window.client('drive-plugin', 'drive', PERSON);

    expect(stored).toEqual({ stored: true });
    expect(keys.entries.has(CLIENT_ACCOUNT)).toBe(true);
    expect(await window.start('drive-plugin', 'drive')).toEqual({ ok: true });
    expect(await window.clearClient('drive-plugin', 'drive')).toEqual({ cleared: true });
    expect(keys.entries.size).toBe(0);
    expect(await window.start('drive-plugin', 'drive')).toMatchObject({
      ok: false,
      reason: 'no-client',
    });
  });

  it("keeps the plugin's own credentials out of the client's account, whatever it declares", async () => {
    const { service, keys } = rig({ entry: withoutClient });
    await service.setClient('drive-plugin', 'drive', PERSON);
    const checked = checkedCapabilities(
      'drive-plugin',
      ['signin:drive', 'credentials:signin-client:drive'],
      { ...desktopCapabilities(keys, () => Promise.reject(new Error('no network'))) },
    );

    for (const key of ['signin-client:drive', CLIENT_ACCOUNT]) {
      await expect(checked.credentials(key)).rejects.toMatchObject({ code: 'E_PERMISSION' });
      await expect(checked.deleteCredential(key)).rejects.toMatchObject({
        code: 'E_PERMISSION',
      });
    }
    expect(JSON.parse(keys.entries.get(CLIENT_ACCOUNT) ?? '')).toEqual(PERSON);
  });
});
