import type { RecipeCredentials, RecipeFetch, RecipeRunnerCalls } from '@tyto/io';
import { RECIPE_CREDENTIAL_KEY_PREFIX } from '@tyto/plugin-api';
import { CALL_CREDENTIAL_NAME } from '@tyto/recipe';

import type { IpcResponse } from '../../shared/ipc.js';
import type { Credentials } from './credentials.js';

/**
 * A recipe's `call` credentials on the desktop (TYTO-671, ADR 0193 decision 5): kept in the OS
 * keychain through `safeStorage`, under `recipe:<name>`, beside a plugin's `plugin:<name>:<key>`
 * and a sign-in's `signin:<plugin>:<id>`.
 *
 * **Write-only from the window.** The plugins screen stores one, lists the names and forgets
 * one; no channel reads a value back. The one reader is `call`'s adapter in `@tyto/io`, which
 * puts it in the `Authorization` header in main and never hands it to the recipe package.
 *
 * Per machine, shared by every workspace on it: the workspace decides where a recipe may send
 * (`recipes.call.hosts`), not which credentials exist.
 */

/** The keychain account of the credential `token=<name>` names. */
export function recipeCredentialAccount(name: string): string {
  return `${RECIPE_CREDENTIAL_KEY_PREFIX}${name}`;
}

export interface RecipeCredentialStore extends RecipeCredentials {
  /** The names stored, sorted. Never a value. */
  list(): Promise<IpcResponse<'recipe-credential:list'>>;
  set(name: string, value: string): Promise<IpcResponse<'recipe-credential:set'>>;
  /** `forgotten` is false when nothing was stored under that name, which is not an error. */
  forget(name: string): Promise<IpcResponse<'recipe-credential:forget'>>;
}

/**
 * Refuses a name `token=` would refuse, so the screen never stores what no recipe can name. The
 * IPC schema checks it too; this is for a caller in main that skipped the bridge.
 */
function checkedName(name: string): string {
  if (!CALL_CREDENTIAL_NAME.test(name)) {
    throw new Error(
      `'${name}' is not a recipe credential's name: lower-case letters, digits and -, ` +
        'starting with a letter, up to 64 characters',
    );
  }
  return name;
}

/**
 * What the desktop lends `call` (ADR 0193 decisions 4 and 5): the open folder's
 * `recipes.call.hosts`, the keychain's `recipe:<name>` credentials, and **sending**, since Apply
 * is a person's click on a plan that shows every request. `fetch` is the platform's unless a test
 * injects one. The runner answers no hosts outside a trusted folder, whatever `hostsFor` says.
 */
export function desktopRecipeCalls(options: {
  readonly hostsFor: (directory: string | undefined) => readonly string[] | undefined;
  readonly credentials: RecipeCredentials;
  readonly fetch?: RecipeFetch;
}): RecipeRunnerCalls {
  return {
    hostsFor: options.hostsFor,
    credentials: options.credentials,
    sends: true,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };
}

export function recipeCredentialStore(credentials: Credentials): RecipeCredentialStore {
  return {
    async read(name) {
      if (!CALL_CREDENTIAL_NAME.test(name)) return undefined;
      const value = await credentials.get(recipeCredentialAccount(name));
      return value ?? undefined;
    },

    async list() {
      const accounts = await credentials.accounts(RECIPE_CREDENTIAL_KEY_PREFIX);
      return {
        names: accounts
          .map((account) => account.slice(RECIPE_CREDENTIAL_KEY_PREFIX.length))
          // A file somebody copied in by hand under a name no recipe could write is not listed.
          .filter((name) => CALL_CREDENTIAL_NAME.test(name)),
      };
    },

    async set(name, value) {
      await credentials.set(recipeCredentialAccount(checkedName(name)), value);
      return { stored: true };
    },

    async forget(name) {
      return { forgotten: await credentials.delete(recipeCredentialAccount(checkedName(name))) };
    },
  };
}
