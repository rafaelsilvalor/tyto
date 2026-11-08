import {
  CREDENTIAL_VALUE_LIMIT_BYTES,
  type HostCapabilities,
  type PluginStore,
  type SigninDeclaration,
  parsePluginManifest,
} from '@tyto/plugin-api';
import { z } from 'zod';

import type { CatalogueKey } from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';
import type { Credentials } from './credentials.js';
import {
  type CallbackListener,
  type CallbackPage,
  type ListenOptions,
  listenForCallback,
} from './loopback.js';
import {
  type RandomBytes,
  type TokenFetch,
  type TokenSet,
  authorizeUrl,
  createPkce,
  createState,
  exchangeCode,
  labelFromIdToken,
  refreshTokens,
} from './oauth.js';

/**
 * Browser sign-in as a host service, in main (ADR 0131, ADR 0174).
 *
 * **The refresh token never leaves this module's keychain entry, and the access token never
 * leaves main's memory except as the answer to `host.signin.accessToken`.** That is the
 * service's one promise, and everything else is arranged around it: the keychain holds
 * `{ refresh, label, since }` under `signin:<plugin>:<id>`, an access token is kept in a map
 * that dies with the process, and the port a plugin reaches answers a string or nothing.
 *
 * A plugin's call never opens a browser (decision 6): `accessToken` only reads and refreshes.
 * Only `start`, which the window calls when a person asks, opens one.
 */

/** The label when the provider sent no `id_token` with a name or email in it. */
export const DEFAULT_SIGNIN_LABEL = 'Signed in';

/**
 * How long an access token is trusted when the provider did not say. RFC 6749 leaves
 * `expires_in` optional; an hour is what the common providers issue, and a token that dies
 * sooner costs the plugin one refused call.
 */
const ASSUMED_LIFETIME_SECONDS = 3600;

/** Refreshed this long before the provider's expiry, so a token never expires in flight. */
const EXPIRY_MARGIN_MS = 60 * 1000;

/** The keychain account of a sign-in, apart from every `plugin:<name>:<key>` (ADR 0134). */
export function signinAccount(plugin: string, id: string): string {
  return `signin:${plugin}:${id}`;
}

const storedSigninSchema = z.object({
  refresh: z.string().min(1),
  label: z.string().min(1),
  since: z.string().min(1),
});

/** What the keychain holds for one sign-in: the refresh token and what the window shows. */
export type StoredSignin = z.infer<typeof storedSigninSchema>;

/** Who is signed in, for the window: never the token. */
export interface SigninStatus {
  readonly label: string;
  /** When the person signed in, ISO 8601. */
  readonly since: string;
}

export type SigninOutcome =
  | ({ readonly ok: true } & SigninStatus)
  | {
      readonly ok: false;
      readonly reason:
        | 'undeclared'
        | 'denied'
        | 'state-mismatch'
        | 'timeout'
        | 'cancelled'
        | 'token'
        | 'no-refresh-token'
        | 'too-large';
      readonly message: string;
    };

export interface SigninServiceOptions {
  readonly credentials: Pick<Credentials, 'get' | 'set' | 'delete'>;
  /** The installed plugin's `signin.<id>`, read now, or `undefined` when it declares none. */
  readonly declarationOf: (plugin: string, id: string) => Promise<SigninDeclaration | undefined>;
  readonly fetch: TokenFetch;
  /** Milliseconds since the epoch; injected so a test moves time without waiting for it. */
  readonly now: () => number;
  /** The system browser; main binds `shell.openExternal`. */
  readonly openBrowser: (url: string) => Promise<void>;
  readonly listen?: (options: ListenOptions) => Promise<CallbackListener>;
  readonly random?: RandomBytes;
  /** The words of the page the browser lands on, asked at each sign-in; English when absent. */
  readonly callbackPage?: () => CallbackPage;
  /**
   * Told after an entry was stored or deleted — a sign-in, a sign-out, or a refresh the
   * provider answered `invalid_grant` — so the window can ask who is signed in again.
   */
  readonly onChanged?: () => void;
}

export interface SigninService {
  /** The port behind `host.signin.accessToken`: a current token, or `undefined`. */
  accessToken(plugin: string, id: string): Promise<string | undefined>;
  /** Runs a sign-in in the system browser. Called from the window, never from a plugin. */
  start(plugin: string, id: string): Promise<SigninOutcome>;
  /** Who is signed in, or `undefined`. */
  status(plugin: string, id: string): Promise<SigninStatus | undefined>;
  /** Deletes the entry and forgets the access token; `true` when there was one. */
  signOut(plugin: string, id: string): Promise<boolean>;
}

interface HeldToken {
  readonly token: string;
  readonly expiresAt: number;
}

export function createSigninService(options: SigninServiceOptions): SigninService {
  const { credentials, now } = options;
  const listen = options.listen ?? listenForCallback;
  const changed = (): void => {
    options.onChanged?.();
  };
  const held = new Map<string, HeldToken>();
  // One refresh per account at a time: two plugin calls at expiry would otherwise both spend
  // the refresh token, and a provider that rotates it refuses the second.
  const refreshing = new Map<string, Promise<string | undefined>>();

  const hold = (account: string, tokens: TokenSet): void => {
    const lifetime = (tokens.expiresIn ?? ASSUMED_LIFETIME_SECONDS) * 1000;
    held.set(account, {
      token: tokens.accessToken,
      expiresAt: now() + lifetime - EXPIRY_MARGIN_MS,
    });
  };

  const readStored = async (account: string): Promise<StoredSignin | undefined> => {
    const plaintext = await credentials.get(account);
    if (plaintext === null) return undefined;
    try {
      const parsed = storedSigninSchema.safeParse(JSON.parse(plaintext));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  };

  const refresh = async (
    plugin: string,
    id: string,
    account: string,
  ): Promise<string | undefined> => {
    const stored = await readStored(account);
    if (stored === undefined) return undefined;
    const declaration = await options.declarationOf(plugin, id);
    if (declaration === undefined) return undefined;
    const answered = await refreshTokens(declaration, stored.refresh, options.fetch);
    if (!answered.ok) {
      if (answered.error === 'invalid_grant') {
        // Revoked, expired or rotated away: a token that will never work again. Deleting it
        // turns the plugin's next answer into E_SIGNIN_REQUIRED, which tells the person what
        // to do, instead of the same refusal from the provider on every call.
        await credentials.delete(account);
        held.delete(account);
        changed();
        return undefined;
      }
      throw new Error(
        `The sign-in '${id}' of ${plugin} could not be refreshed: ${answered.message}`,
      );
    }
    hold(account, answered.tokens);
    const rotated = answered.tokens.refreshToken;
    if (rotated !== undefined && rotated !== stored.refresh) {
      await credentials.set(account, JSON.stringify({ ...stored, refresh: rotated }));
    }
    return answered.tokens.accessToken;
  };

  return {
    async accessToken(plugin, id) {
      const account = signinAccount(plugin, id);
      const current = held.get(account);
      if (current !== undefined && current.expiresAt > now()) return current.token;
      const inFlight = refreshing.get(account);
      if (inFlight !== undefined) return inFlight;
      const attempt = refresh(plugin, id, account).finally(() => refreshing.delete(account));
      refreshing.set(account, attempt);
      return attempt;
    },

    async start(plugin, id) {
      const declaration = await options.declarationOf(plugin, id);
      if (declaration === undefined) {
        return {
          ok: false,
          reason: 'undeclared',
          message: `${plugin} declares no sign-in '${id}'`,
        };
      }
      const pkce = await createPkce(options.random);
      const state = createState(options.random);
      const page = options.callbackPage?.();
      const listener = await listen(page === undefined ? { state } : { state, page });
      try {
        await options.openBrowser(
          authorizeUrl({
            declaration,
            redirectUri: listener.redirectUri,
            challenge: pkce.challenge,
            state,
          }),
        );
      } catch (cause) {
        listener.close();
        throw cause;
      }
      const outcome = await listener.outcome;
      switch (outcome.kind) {
        case 'error':
          return { ok: false, reason: 'denied', message: outcome.error };
        case 'state-mismatch':
          return {
            ok: false,
            reason: 'state-mismatch',
            message: 'the callback did not come from this sign-in',
          };
        case 'timeout':
          return { ok: false, reason: 'timeout', message: 'nothing came back within five minutes' };
        case 'closed':
          return { ok: false, reason: 'cancelled', message: 'the sign-in was cancelled' };
        case 'code':
          break;
      }
      const answered = await exchangeCode({
        declaration,
        code: outcome.code,
        verifier: pkce.verifier,
        redirectUri: listener.redirectUri,
        fetch: options.fetch,
      });
      if (!answered.ok) return { ok: false, reason: 'token', message: answered.message };
      const { refreshToken } = answered.tokens;
      if (refreshToken === undefined) {
        // Only the refresh token is stored (decision 8); without one the sign-in would last
        // until the app quits, which is not what the window would say it did.
        return {
          ok: false,
          reason: 'no-refresh-token',
          message:
            'the provider sent no refresh token; some providers send one only when the ' +
            'authorize URL asks for offline access',
        };
      }
      const record: StoredSignin = {
        refresh: refreshToken,
        label: labelFromIdToken(answered.tokens.idToken) ?? DEFAULT_SIGNIN_LABEL,
        since: new Date(now()).toISOString(),
      };
      const plaintext = JSON.stringify(record);
      if (Buffer.byteLength(plaintext, 'utf8') > CREDENTIAL_VALUE_LIMIT_BYTES) {
        return {
          ok: false,
          reason: 'too-large',
          message: `the provider's refresh token is larger than ${CREDENTIAL_VALUE_LIMIT_BYTES} bytes`,
        };
      }
      const account = signinAccount(plugin, id);
      await credentials.set(account, plaintext);
      hold(account, answered.tokens);
      changed();
      return { ok: true, label: record.label, since: record.since };
    },

    async status(plugin, id) {
      const stored = await readStored(signinAccount(plugin, id));
      return stored === undefined ? undefined : { label: stored.label, since: stored.since };
    },

    async signOut(plugin, id) {
      const account = signinAccount(plugin, id);
      held.delete(account);
      const deleted = await credentials.delete(account);
      if (deleted) changed();
      return deleted;
    },
  };
}

/**
 * The port a plugin reaches, and only it: `checkedCapabilities` has already refused an
 * undeclared id (ADR 0174, decision 5), and what crosses is the access token or nothing.
 */
export function signinCapabilities(
  service: Pick<SigninService, 'accessToken'>,
): Required<Pick<HostCapabilities, 'signinAccessToken'>> {
  return { signinAccessToken: (plugin, id) => service.accessToken(plugin, id) };
}

/**
 * Reads `signin.<id>` from the installed plugin's manifest at every call, so a reinstall that
 * changed an endpoint is the endpoint the next refresh uses.
 */
export function installedSigninDeclarations(
  store: Pick<PluginStore, 'list'>,
): (plugin: string, id: string) => Promise<SigninDeclaration | undefined> {
  return async (plugin, id) => {
    const stored = (await store.list()).find((entry) => entry.folder === plugin);
    if (stored?.manifestSource === undefined) return undefined;
    const parsed = parsePluginManifest(stored.manifestSource);
    if (!parsed.ok) return undefined;
    return parsed.value.signin?.[id];
  };
}

/** One declared sign-in, for the plugins screen: who is signed in, never a token. */
export interface SigninRow {
  /** The plugin's folder under `TYTO_HOME/plugins`, which is its name. */
  readonly plugin: string;
  readonly id: string;
  readonly signedIn: boolean;
  /**
   * The `id_token`'s email or name, absent when the provider sent none: the window then says
   * "Signed in" in its own language rather than the English default the keychain holds.
   */
  readonly label?: string;
  readonly since?: string;
}

/**
 * Every `signin.<id>` of every installed plugin whose manifest reads, in folder order, with
 * who is signed in to each. A refused folder declares nothing the host would run, so it has
 * no rows; a disabled plugin keeps its rows, since signing out of it still makes sense.
 */
export async function listSignins(
  store: Pick<PluginStore, 'list'>,
  service: Pick<SigninService, 'status'>,
): Promise<readonly SigninRow[]> {
  const rows: SigninRow[] = [];
  for (const stored of await store.list()) {
    if (stored.manifestSource === undefined) continue;
    const parsed = parsePluginManifest(stored.manifestSource);
    if (!parsed.ok) continue;
    for (const id of Object.keys(parsed.value.signin ?? {})) {
      const status = await service.status(stored.folder, id);
      if (status === undefined) {
        rows.push({ plugin: stored.folder, id, signedIn: false });
        continue;
      }
      rows.push({
        plugin: stored.folder,
        id,
        signedIn: true,
        since: status.since,
        ...(status.label === DEFAULT_SIGNIN_LABEL ? {} : { label: status.label }),
      });
    }
  }
  return rows;
}

/** What the plugins screen reaches through `signin:list`, `signin:start` and `signin:out`. */
export interface SigninWindow {
  list(): Promise<IpcResponse<'signin:list'>>;
  start(plugin: string, id: string): Promise<IpcResponse<'signin:start'>>;
  out(plugin: string, id: string): Promise<IpcResponse<'signin:out'>>;
}

/**
 * The window's side of the service (TYTO-374). A plugin or id nobody declares is rejected
 * before anything runs, so the window cannot sign in to, or delete, an account under
 * `signin:` that no installed manifest names. A sign-in that throws — no keychain to encrypt
 * with, a browser that would not open — answers `failed` with its message, so the screen can
 * say what happened; **the answer carries no token either way**, only whether it worked.
 */
export function signinWindow(
  store: Pick<PluginStore, 'list'>,
  service: Pick<SigninService, 'start' | 'status' | 'signOut'>,
): SigninWindow {
  const declarationOf = installedSigninDeclarations(store);
  const declared = async (plugin: string, id: string): Promise<void> => {
    if ((await declarationOf(plugin, id)) === undefined) {
      throw new TypeError(`No installed plugin '${plugin}' declares the sign-in '${id}'`);
    }
  };
  return {
    list: async () => ({ signins: [...(await listSignins(store, service))] }),
    start: async (plugin, id) => {
      await declared(plugin, id);
      try {
        const outcome = await service.start(plugin, id);
        if (outcome.ok) return { ok: true };
        // `undeclared` was refused above; a reinstall in between lands here.
        const reason = outcome.reason === 'undeclared' ? 'failed' : outcome.reason;
        return { ok: false, reason, message: outcome.message };
      } catch (cause) {
        return {
          ok: false,
          reason: 'failed',
          message: cause instanceof Error ? cause.message : String(cause),
        };
      }
    },
    out: async (plugin, id) => {
      await declared(plugin, id);
      return { signedOut: await service.signOut(plugin, id) };
    },
  };
}

/**
 * The callback page in the window's language (ADR 0174, note of 2026-11-08). Keys under
 * `plugins.signin.page.`, which are never element text: the browser shows them, not the window.
 */
export function signinCallbackPage(say: (key: CatalogueKey) => string, lang: string): CallbackPage {
  return {
    lang,
    messages: {
      code: say('plugins.signin.page.signedIn'),
      error: say('plugins.signin.page.unfinished'),
      'state-mismatch': say('plugins.signin.page.refused'),
      timeout: say('plugins.signin.page.timeout'),
      closed: say('plugins.signin.page.cancelled'),
      notFound: say('plugins.signin.page.notFound'),
    },
    close: say('plugins.signin.page.close'),
  };
}
