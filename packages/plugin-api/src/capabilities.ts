import { type Diagnostic, diagnostic } from '@tyto/core';

/**
 * The runtime's own, read off `globalThis`: this package compiles against no platform's
 * types (ADR 0010), and every runtime it targets — Node, a worker, a browser — has both.
 */
const { URL, TextDecoder, TextEncoder } = globalThis as unknown as {
  URL: new (input: string) => {
    readonly href: string;
    readonly protocol: string;
    readonly hostname: string;
  };
  TextDecoder: new () => { decode(bytes: Uint8Array): string };
  TextEncoder: new () => { encode(text: string): Uint8Array };
};

/**
 * The largest credential a plugin may store, in UTF-8 bytes (ADR 0134). A Google
 * service-account key, the largest secret a connector is known to keep, measured 2,333 B
 * with RSA-2048 and 3,925 B with RSA-4096; 16 KiB leaves four times the larger one and
 * still keeps a keychain entry a keychain entry rather than a file store.
 */
export const CREDENTIAL_VALUE_LIMIT_BYTES = 16 * 1024;

/** A credential's size as the ceiling counts it: UTF-8 bytes, not UTF-16 code units. */
export function credentialByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * `host.fetch` and `host.credentials`: what a plugin may ask of the network and of secrets,
 * and the one place the answer is decided (E11.2, ADR 0042).
 *
 * **Declared, or refused.** A plugin reaches a host only if its `tyto-plugin.json` declares
 * `net:<host>`, and a credential only if it declares `credentials:<key>`. The check runs on
 * the host's side, against the manifest the host validated — never in the plugin's process,
 * whose code could simply skip it.
 *
 * The network and the secrets themselves are ports (`HostCapabilities`): the CLI answers
 * with Node's `fetch` and its environment, the desktop will answer with `safeStorage`. This
 * package decides only *whether*, which is why it stays pure (ADR 0010).
 */

/** A request, as a plugin can make it and as a message can carry it. */
export interface HostFetchInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
}

/**
 * A response, whole. Read in full before it crosses, because a stream cannot be cloned
 * into a message; `text()` and `json()` are the conveniences a plugin reaches for.
 */
export interface HostFetchResponse {
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly ok: boolean;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** The response's data, as an adapter answers and as a message carries it. */
export type FetchedResponse = Omit<HostFetchResponse, 'ok' | 'text' | 'json'>;

/** What an app provides, and what the permission check stands in front of. */
export interface HostCapabilities {
  /**
   * The request, already allowed. **An adapter must not follow redirects**: a redirect to
   * a host the plugin never declared would be the check answered for somebody else, so the
   * 3xx comes back to the plugin, whose next request is checked like its first.
   */
  fetch(url: string, init: HostFetchInit): Promise<FetchedResponse>;
  /** The value, or `undefined` when this host holds none. */
  credential(plugin: string, key: string): Promise<string | undefined>;
  /** Where {@link credential} looks, for the message that says it found nothing. */
  describeCredential(plugin: string, key: string): string;
  /**
   * Stores a value, already allowed and within the ceiling. Absent on a host whose
   * secrets only read — the CLI's environment — which answers `E_CREDENTIAL_READ_ONLY`.
   */
  storeCredential?(plugin: string, key: string, value: string): Promise<void>;
  /** Forgets a value; `true` when there was one. Absent exactly when the writer is. */
  deleteCredential?(plugin: string, key: string): Promise<boolean>;
}

/**
 * A refusal a plugin can catch and tell apart: `error.code` is the diagnostic's code.
 *
 * Thrown — rejected — rather than answered as a `Result`, because `host.fetch` stands in for
 * the platform's `fetch`, which rejects, and a plugin written against one should not have to
 * learn a second shape for the other.
 */
export class PluginCapabilityError extends Error {
  readonly code: string;
  readonly diagnostic: Diagnostic;

  constructor(problem: Diagnostic) {
    super(problem.message);
    this.name = 'PluginCapabilityError';
    this.code = problem.code;
    this.diagnostic = problem;
  }
}

/**
 * `net:api.example.com` names one host; `net:*.example.com` every host below it, and not
 * `example.com` itself; `net:*` any host. Compared with `URL.hostname`, which the URL parser
 * has already lowercased and stripped of a port, so `net:` never names a port.
 */
export function allowsHost(permissions: readonly string[], hostname: string): boolean {
  const host = hostname.toLowerCase();
  return permissions.some((permission) => {
    if (!permission.startsWith('net:')) return false;
    const pattern = permission.slice('net:'.length).toLowerCase();
    if (pattern === '*') return true;
    if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1));
    return pattern === host;
  });
}

export function allowsCredential(permissions: readonly string[], key: string): boolean {
  return permissions.includes(`credentials:${key}`);
}

/** A plugin's own `host.fetch` and `host.credentials`, checked against what it declared. */
export interface PluginCapabilities {
  fetch(url: string, init?: HostFetchInit): Promise<FetchedResponse>;
  credentials(key: string): Promise<string>;
  storeCredential(key: string, value: string): Promise<void>;
  deleteCredential(key: string): Promise<boolean>;
}

/**
 * `host.credentials`: called, it reads a key, as it always has; `.set` stores one and
 * `.delete` forgets one, behind the same `credentials:<key>` permission (ADR 0134). One
 * object rather than three methods so that a plugin written before the writers still reads
 * the way it did.
 */
export interface HostCredentials {
  (key: string): Promise<string>;
  /** Stores a non-empty value of at most {@link CREDENTIAL_VALUE_LIMIT_BYTES} UTF-8 bytes. */
  set(key: string, value: string): Promise<void>;
  /** Forgets a value; `true` when there was one to forget. */
  delete(key: string): Promise<boolean>;
}

/** The callable object both sides of the isolation boundary hand a plugin. */
export function hostCredentials(
  read: (key: string) => Promise<string>,
  set: (key: string, value: string) => Promise<void>,
  forget: (key: string) => Promise<boolean>,
): HostCredentials {
  return Object.assign((key: string) => read(key), { set, delete: forget });
}

function refuse(problem: Diagnostic): Promise<never> {
  return Promise.reject(new PluginCapabilityError(problem));
}

/**
 * The checks, in front of an app's capabilities.
 *
 * `capabilities` may be absent — a host composed with no network and no secrets, as every
 * built-in's is. An undeclared request is still `E_PERMISSION`, and a declared one then
 * fails for want of a network or a secret rather than for how the plugin asked.
 */
export function checkedCapabilities(
  plugin: string,
  permissions: readonly string[],
  capabilities: HostCapabilities | undefined,
): PluginCapabilities {
  return {
    fetch(url, init = {}) {
      let parsed: InstanceType<typeof URL>;
      try {
        parsed = new URL(url);
      } catch {
        // What the platform's `fetch` does with a URL it cannot parse, and not a permission:
        // no declaration could have made this request work.
        return Promise.reject(new TypeError(`host.fetch cannot parse the URL '${url}'.`));
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        const scheme = parsed.protocol.replace(/:$/u, '');
        return refuse(
          diagnostic('E_PERMISSION', { plugin, capability: `host.fetch of a ${scheme} URL` }),
        );
      }
      if (!allowsHost(permissions, parsed.hostname)) {
        return refuse(
          diagnostic('E_PERMISSION', {
            plugin,
            capability: `host.fetch to ${parsed.hostname} (net:${parsed.hostname})`,
          }),
        );
      }
      if (capabilities === undefined) {
        return Promise.reject(new Error('this host was composed without a network for plugins.'));
      }
      return capabilities.fetch(parsed.href, init);
    },

    async credentials(key) {
      if (!allowsCredential(permissions, key)) {
        return refuse(
          diagnostic('E_PERMISSION', {
            plugin,
            capability: `host.credentials('${key}') (credentials:${key})`,
          }),
        );
      }
      const value = await capabilities?.credential(plugin, key);
      if (value === undefined) {
        return refuse(
          diagnostic('E_CREDENTIAL_MISSING', {
            plugin,
            key,
            source: capabilities?.describeCredential(plugin, key) ?? 'this host',
          }),
        );
      }
      return value;
    },

    async storeCredential(key, value) {
      if (!allowsCredential(permissions, key)) {
        return refuse(
          diagnostic('E_PERMISSION', {
            plugin,
            capability: `host.credentials.set('${key}') (credentials:${key})`,
          }),
        );
      }
      if (value.length === 0) {
        // Not a permission and not a size: an empty secret is a delete spelled wrong, and
        // storing one would make "set" and "missing" disagree about what a key holds.
        throw new TypeError(
          `host.credentials.set('${key}') was given an empty value; use host.credentials.delete.`,
        );
      }
      const bytes = credentialByteLength(value);
      if (bytes > CREDENTIAL_VALUE_LIMIT_BYTES) {
        return refuse(
          diagnostic('E_CREDENTIAL_TOO_LARGE', {
            plugin,
            key,
            bytes: String(bytes),
            limit: String(CREDENTIAL_VALUE_LIMIT_BYTES),
          }),
        );
      }
      if (capabilities?.storeCredential === undefined) {
        return refuse(readOnly(plugin, key, capabilities));
      }
      await capabilities.storeCredential(plugin, key, value);
    },

    async deleteCredential(key) {
      if (!allowsCredential(permissions, key)) {
        return refuse(
          diagnostic('E_PERMISSION', {
            plugin,
            capability: `host.credentials.delete('${key}') (credentials:${key})`,
          }),
        );
      }
      if (capabilities?.deleteCredential === undefined) {
        return refuse(readOnly(plugin, key, capabilities));
      }
      return capabilities.deleteCredential(plugin, key);
    },
  };
}

function readOnly(
  plugin: string,
  key: string,
  capabilities: HostCapabilities | undefined,
): Diagnostic {
  return diagnostic('E_CREDENTIAL_READ_ONLY', {
    plugin,
    key,
    source: capabilities?.describeCredential(plugin, key) ?? 'this host',
  });
}

/** The data of a response, with the conveniences a plugin expects of one. */
export function responseOf(fetched: FetchedResponse): HostFetchResponse {
  const text = (): Promise<string> => Promise.resolve(new TextDecoder().decode(fetched.body));
  return {
    ...fetched,
    ok: fetched.status >= 200 && fetched.status < 300,
    text,
    json: async () => JSON.parse(await text()) as unknown,
  };
}
