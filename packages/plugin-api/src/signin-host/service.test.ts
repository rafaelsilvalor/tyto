import { describe, expect, it } from 'vitest';

import type { SigninDeclaration } from '../manifest.js';
import type { CallbackListen, CallbackOutcome } from './callback.js';
import { type TokenFetch, base64Url } from './oauth.js';
import {
  DEFAULT_SIGNIN_LABEL,
  type SigninSecrets,
  createSigninService,
  signinAccount,
  signinClientAccount,
} from './service.js';

/**
 * The shared sign-in service at the package level (TYTO-683): every port a fake, so what is
 * under test is the service's own promise — only the refresh token is stored, the access token
 * stays in memory, a refused refresh forgets the entry — whichever host composes it. The real
 * listener and a provider on 127.0.0.1 are `@tyto/command-line`'s `signin.test.ts`.
 */

const { URL, URLSearchParams, TextEncoder } = globalThis as unknown as {
  URL: new (input: string) => { readonly searchParams: { get(name: string): string | null } };
  URLSearchParams: new (init: string) => { get(name: string): string | null };
  TextEncoder: new () => { encode(text: string): Uint8Array };
};

const PLUGIN = 'drive-plugin';
const ID = 'drive';

const DECLARATION: SigninDeclaration = {
  authorize: 'https://auth.example.test/authorize',
  token: 'https://auth.example.test/token',
  clientId: 'manifest-client',
  scopes: ['files'],
};

function idToken(claims: object): string {
  return `e30.${base64Url(new TextEncoder().encode(JSON.stringify(claims)))}.signature`;
}

function mapSecrets(): SigninSecrets & { readonly entries: Map<string, string> } {
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

interface Rig {
  service: ReturnType<typeof createSigninService>;
  readonly secrets: ReturnType<typeof mapSecrets>;
  readonly grants: string[];
  readonly opened: string[];
  readonly clock: { now: number };
  changes: number;
  /** What the next callback carries; `code` by default. */
  callback: CallbackOutcome;
  codeAnswer: { status: number; body: object };
  refreshAnswer: { status: number; body: object };
}

function rig(declaration: SigninDeclaration = DECLARATION): Rig {
  const secrets = mapSecrets();
  let arrive: (outcome: CallbackOutcome) => void = () => undefined;
  const state: Rig = {
    service: undefined as unknown as Rig['service'],
    secrets,
    grants: [],
    opened: [],
    clock: { now: Date.parse('2026-11-12T12:00:00.000Z') },
    changes: 0,
    callback: { kind: 'code', code: 'code-1' },
    codeAnswer: {
      status: 200,
      body: {
        access_token: 'access-1',
        expires_in: 3600,
        refresh_token: 'refresh-1',
        id_token: idToken({ email: 'person@example.test' }),
      },
    },
    refreshAnswer: { status: 200, body: { access_token: 'access-2', expires_in: 3600 } },
  };
  const listen: CallbackListen = () => {
    const outcome = new Promise<CallbackOutcome>((resolve) => {
      arrive = resolve;
    });
    return Promise.resolve({
      redirectUri: 'http://127.0.0.1:43210/callback',
      address: { address: '127.0.0.1', family: 'IPv4', port: 43210 },
      outcome,
      close: () => arrive({ kind: 'closed' }),
    });
  };
  const fetch: TokenFetch = (_url, init) => {
    const grant = new URLSearchParams(init.body);
    const type = grant.get('grant_type') ?? '';
    state.grants.push(type);
    const answer = type === 'authorization_code' ? state.codeAnswer : state.refreshAnswer;
    return Promise.resolve({
      status: answer.status,
      text: () => Promise.resolve(JSON.stringify(answer.body)),
    });
  };
  state.service = createSigninService({
    credentials: secrets,
    declarationOf: (plugin, id) =>
      Promise.resolve(plugin === PLUGIN && id === ID ? declaration : undefined),
    fetch,
    now: () => state.clock.now,
    openBrowser: (url) => {
      state.opened.push(url);
      // The browser comes back on the next turn, as a real one would.
      void Promise.resolve().then(() => arrive(state.callback));
      return Promise.resolve();
    },
    listen,
    onChanged: () => {
      state.changes += 1;
    },
  });
  return state;
}

describe('the shared sign-in service (TYTO-683)', () => {
  it('stores only the refresh token and who signed in, and answers the access token from memory', async () => {
    const { service, secrets, grants, opened } = rig();

    expect(await service.start(PLUGIN, ID)).toEqual({
      ok: true,
      label: 'person@example.test',
      since: '2026-11-12T12:00:00.000Z',
    });

    expect(opened).toHaveLength(1);
    expect(new URL(opened[0] ?? '').searchParams.get('client_id')).toBe('manifest-client');
    expect([...secrets.entries.keys()]).toEqual([signinAccount(PLUGIN, ID)]);
    expect(JSON.parse(secrets.entries.get(signinAccount(PLUGIN, ID)) ?? '')).toEqual({
      refresh: 'refresh-1',
      label: 'person@example.test',
      since: '2026-11-12T12:00:00.000Z',
    });
    expect(await service.accessToken(PLUGIN, ID)).toBe('access-1');
    expect(grants).toEqual(['authorization_code']);
  });

  it('refreshes once past the expiry, however many calls arrive at once', async () => {
    const state = rig();
    await state.service.start(PLUGIN, ID);
    state.clock.now += 3600 * 1000;

    const answers = await Promise.all([
      state.service.accessToken(PLUGIN, ID),
      state.service.accessToken(PLUGIN, ID),
    ]);

    expect(answers).toEqual(['access-2', 'access-2']);
    expect(state.grants).toEqual(['authorization_code', 'refresh_token']);
  });

  it('forgets the entry when the refresh is answered invalid_grant', async () => {
    const state = rig();
    await state.service.start(PLUGIN, ID);
    state.clock.now += 3600 * 1000;
    state.refreshAnswer = { status: 400, body: { error: 'invalid_grant' } };
    const before = state.changes;

    expect(await state.service.accessToken(PLUGIN, ID)).toBeUndefined();
    expect(state.secrets.entries.size).toBe(0);
    expect(state.changes).toBe(before + 1);
  });

  it('trades nothing for a callback from another attempt', async () => {
    const state = rig();
    state.callback = { kind: 'state-mismatch' };

    expect(await state.service.start(PLUGIN, ID)).toMatchObject({
      ok: false,
      reason: 'state-mismatch',
    });
    expect(state.grants).toEqual([]);
    expect(state.secrets.entries.size).toBe(0);
  });

  it('stores nothing larger than a keychain entry may hold', async () => {
    const state = rig();
    state.codeAnswer = {
      status: 200,
      body: { access_token: 'access-1', refresh_token: 'r'.repeat(17 * 1024) },
    };

    expect(await state.service.start(PLUGIN, ID)).toMatchObject({ ok: false, reason: 'too-large' });
    expect(state.secrets.entries.size).toBe(0);
  });

  it('says "Signed in" when the provider sends no id_token', async () => {
    const state = rig();
    state.codeAnswer = {
      status: 200,
      body: { access_token: 'access-1', refresh_token: 'refresh-1' },
    };

    expect(await state.service.start(PLUGIN, ID)).toMatchObject({ label: DEFAULT_SIGNIN_LABEL });
  });

  describe('a client the person supplies (ADR 0192)', () => {
    const withoutClient: SigninDeclaration = {
      authorize: DECLARATION.authorize,
      token: DECLARATION.token,
      scopes: DECLARATION.scopes,
    };

    it('answers no-client, in words that name no host, and opens no browser', async () => {
      const state = rig(withoutClient);

      const outcome = await state.service.start(PLUGIN, ID);

      expect(outcome).toMatchObject({ ok: false, reason: 'no-client' });
      expect(outcome.ok ? '' : outcome.message).not.toContain('screen');
      expect(state.opened).toEqual([]);
    });

    it('signs in with the stored client, and ends that sign-in when the client changes', async () => {
      const state = rig(withoutClient);
      await state.service.setClient(PLUGIN, ID, { clientId: 'typed-client' });
      await state.service.start(PLUGIN, ID);

      expect(new URL(state.opened[0] ?? '').searchParams.get('client_id')).toBe('typed-client');
      expect(state.secrets.entries.has(signinAccount(PLUGIN, ID))).toBe(true);

      await state.service.setClient(PLUGIN, ID, { clientId: 'another-client' });

      expect(state.secrets.entries.has(signinAccount(PLUGIN, ID))).toBe(false);
      expect(JSON.parse(state.secrets.entries.get(signinClientAccount(PLUGIN, ID)) ?? '')).toEqual({
        clientId: 'another-client',
      });
      expect(await state.service.accessToken(PLUGIN, ID)).toBeUndefined();
    });
  });

  it('signs out by deleting the entry and forgetting the access token', async () => {
    const state = rig();
    await state.service.start(PLUGIN, ID);

    expect(await state.service.signOut(PLUGIN, ID)).toBe(true);
    expect(state.secrets.entries.size).toBe(0);
    expect(await state.service.accessToken(PLUGIN, ID)).toBeUndefined();
    expect(await state.service.signOut(PLUGIN, ID)).toBe(false);
  });
});
