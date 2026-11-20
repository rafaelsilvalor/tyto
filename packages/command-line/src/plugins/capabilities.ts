import type { Trust } from '@tyto/core';
import { pluginCache, pluginStorage, workspaceFiles } from '@tyto/io';
import {
  type DecodeGrants,
  type FetchedResponse,
  type HostCapabilities,
  type HostFetchInit,
  type TokenFetch,
  decodeGrants,
} from '@tyto/plugin-api';

/**
 * The network and the secrets an installed plugin reaches through `host.fetch` and
 * `host.credentials`, for the CLI (E11.2, ADR 0042).
 *
 * Only ever called **after** `@tyto/plugin-api` has checked the plugin's declared
 * permissions; nothing here decides whether a plugin may ask.
 *
 * **A credential is an environment variable**: `TYTO_PLUGIN_<NAME>_<KEY>`, both halves in
 * upper case with every character that is not a letter or a digit turned into `_`. So
 * plugin `meu-pdf`'s `api.token` is `TYTO_PLUGIN_MEU_PDF_API_TOKEN`. The environment is
 * what a CLI in a CI job or a cron line already has for secrets, and Tyto stores none
 * (ADR 0011); the desktop answers from `safeStorage` instead.
 *
 * **The cache and the workspace files** (ADR 0138) are given when the command has them: the
 * cache wherever there is a `TYTO_HOME`, the workspace files only to `tyto render`, against the
 * folder `findWorkspace` found and its trust. `tyto watch` has no folder a person opened and
 * trusted (ADR 0118), so its refusal names it.
 */

type Variables = Readonly<Record<string, string | undefined>>;

function normalise(part: string): string {
  return part.toUpperCase().replace(/[^A-Z0-9]/gu, '_');
}

/** The variable `host.credentials(key)` reads for `plugin`. */
export function credentialVariable(plugin: string, key: string): string {
  return `TYTO_PLUGIN_${normalise(plugin)}_${normalise(key)}`;
}

async function fetchWithoutRedirects(url: string, init: HostFetchInit): Promise<FetchedResponse> {
  const response = await fetch(url, {
    ...(init.method === undefined ? {} : { method: init.method }),
    ...(init.headers === undefined ? {} : { headers: { ...init.headers } }),
    ...(init.body === undefined ? {} : { body: init.body }),
    // Never followed: a redirect to a host the plugin did not declare would be the
    // permission check answered for somebody else. The plugin gets the 3xx and its
    // `location`, and asks again — through the check (ADR 0042).
    redirect: 'manual',
  });
  return {
    url: response.url === '' ? url : response.url,
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers),
    body: new Uint8Array(await response.arrayBuffer()),
  };
}

/**
 * The token endpoint's network for `tyto signin` (ADR 0194), here because this is the one file
 * of the CLI that may reach for `fetch`. The sign-in service already asks for no redirect.
 */
export const tokenFetch: TokenFetch = (url, init) =>
  fetch(url, { ...init, headers: { ...init.headers } });

/**
 * The decode tokens this process has handed out (ADR 0223): one table, because the installed
 * plugins are started once per process and every task's host asks the same processes. A render
 * task mints a token through its `decode` for one call; a plugin reads through it with
 * `host.decoding.read`, which reaches {@link pluginCapabilities}'s `decodeReadPart` below.
 */
export const processDecodeGrants: DecodeGrants = decodeGrants();

/** What a command adds to the network and the secrets (ADR 0138). */
export interface CommandCapabilities {
  /** The name a refusal gives the command: `tyto render`, `tyto watch`. */
  readonly hostName?: string;
  /** `TYTO_HOME`, where the cache lives; absent, the command keeps none. */
  readonly home?: string;
  /**
   * The brief's workspace, or `undefined` for a brief in none — a call then answers that no
   * folder is open. Absent altogether, the command gives plugins no workspace files.
   */
  readonly workspace?: { readonly folder?: string; readonly trust: Trust };
  /** The terminal's sign-ins (ADR 0194); absent, a plugin's call is `E_SIGNIN_UNAVAILABLE`. */
  readonly signin?: Pick<HostCapabilities, 'signinAccessToken' | 'describeSignin'> | undefined;
}

export function pluginCapabilities(
  variables: Variables = {},
  command: CommandCapabilities = {},
): HostCapabilities {
  const { workspace } = command;
  return {
    ...(command.hostName === undefined ? {} : { hostName: command.hostName }),
    ...(command.home === undefined ? {} : pluginCache({ home: command.home })),
    ...(command.home === undefined ? {} : pluginStorage({ home: command.home })),
    ...(workspace === undefined
      ? {}
      : workspaceFiles({ folder: () => workspace.folder, trust: () => workspace.trust })),
    ...command.signin,
    // Every command: a token is the grant (ADR 0223), and only a render task mints one.
    decodeReadPart: (plugin, token, offset, length) =>
      processDecodeGrants.readPart(plugin, token, offset, length),
    fetch: fetchWithoutRedirects,
    credential: (plugin, key) => {
      const value = variables[credentialVariable(plugin, key)];
      // An exported empty variable is a secret nobody set, not an empty secret.
      return Promise.resolve(value === undefined || value === '' ? undefined : value);
    },
    describeCredential: (plugin, key) =>
      `the environment variable ${credentialVariable(plugin, key)}`,
  };
}
