import type { FetchedResponse, HostCapabilities, HostFetchInit } from '@tyto/plugin-api';

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

export function pluginCapabilities(variables: Variables = {}): HostCapabilities {
  return {
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
