import {
  type CallbackPage,
  type PluginStore,
  type SigninClient,
  type SigninService,
  type SigninServiceOptions,
  createSigninService as createSharedSigninService,
  installedSigninDeclarations,
  listSignins,
} from '@tyto/plugin-api';
import { listenForCallback } from '@tyto/io';

import type { CatalogueKey } from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';

/**
 * Browser sign-in in the desktop (ADR 0131, ADR 0174): the window's side of the shared service.
 *
 * The service itself — PKCE, the token endpoint, the keychain entries and the one promise that
 * the refresh token never leaves its entry — lives in `@tyto/plugin-api` since TYTO-683, so the
 * CLI can run the same flow, and its loopback listener in `@tyto/io`. What stays here is what
 * only a window has: the plugins screen's channels and the callback page in its language.
 */

export {
  DEFAULT_SIGNIN_LABEL,
  type SigninClient,
  type SigninClientState,
  type SigninOutcome,
  type SigninRow,
  type SigninService,
  type SigninStatus,
  type StoredSignin,
  installedSigninDeclarations,
  listSignins,
  signinAccount,
  signinCapabilities,
  signinClientAccount,
} from '@tyto/plugin-api';

/** The shared service with the desktop's loopback listener, unless a caller binds another. */
export function createSigninService(
  options: Omit<SigninServiceOptions, 'listen'> & Partial<Pick<SigninServiceOptions, 'listen'>>,
): SigninService {
  return createSharedSigninService({ listen: listenForCallback, ...options });
}

/**
 * What the plugins screen reaches through `signin:list`, `signin:start`, `signin:cancel`,
 * `signin:out`,
 * `signin:client` and `signin:client-clear`.
 */
export interface SigninWindow {
  list(): Promise<IpcResponse<'signin:list'>>;
  start(plugin: string, id: string): Promise<IpcResponse<'signin:start'>>;
  cancel(plugin: string, id: string): Promise<IpcResponse<'signin:cancel'>>;
  out(plugin: string, id: string): Promise<IpcResponse<'signin:out'>>;
  client(plugin: string, id: string, client: SigninClient): Promise<IpcResponse<'signin:client'>>;
  clearClient(plugin: string, id: string): Promise<IpcResponse<'signin:client-clear'>>;
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
  service: Pick<
    SigninService,
    'start' | 'cancel' | 'status' | 'signOut' | 'setClient' | 'clearClient' | 'hasClient'
  >,
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
    cancel: async (plugin, id) => {
      await declared(plugin, id);
      return { cancelled: service.cancel(plugin, id) };
    },
    out: async (plugin, id) => {
      await declared(plugin, id);
      return { signedOut: await service.signOut(plugin, id) };
    },
    // The service refuses a sign-in nobody declares and one whose manifest names its client:
    // the person never overrides a client the plugin's author fixed (ADR 0192). The answer
    // says it was stored and never echoes it.
    client: async (plugin, id, client) => {
      await service.setClient(plugin, id, client);
      return { stored: true };
    },
    clearClient: async (plugin, id) => ({ cleared: await service.clearClient(plugin, id) }),
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
