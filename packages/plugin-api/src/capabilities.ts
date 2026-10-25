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
 * The longest cache key a plugin may choose, in UTF-8 bytes (ADR 0138). A key is opaque to
 * the host, which stores it by its hash; the ceiling keeps the sidecar that remembers it small.
 */
export const PLUGIN_CACHE_KEY_LIMIT_BYTES = 1024;

/**
 * The largest cache entry, and the largest workspace file a plugin reads or writes, in bytes
 * (ADR 0138). One answer crosses whole as one message, and 32 MiB is a bound on that message,
 * not on the cache: the cache as a whole has no ceiling (ADR 0130).
 */
export const PLUGIN_FILE_LIMIT_BYTES = 32 * 1024 * 1024;

/** One cache entry, as `host.cache.get` answers it. `storedAt` is the host's clock, ISO 8601. */
export interface PluginCacheEntry {
  readonly bytes: Uint8Array;
  readonly storedAt: string;
}

/** One cache entry, as `host.cache.list` describes it without reading it. */
export interface PluginCacheListing {
  readonly key: string;
  readonly storedAt: string;
  /** In bytes. */
  readonly size: number;
}

/** What `host.cache.put` answers: when the host stored it, by its own clock. */
export interface PluginCacheStored {
  readonly storedAt: string;
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

  /**
   * The name a refusal gives this host when it lacks a port below — `tyto`, `tyto watch`,
   * `the desktop`. Absent, the refusal says "this host".
   */
  readonly hostName?: string;

  /*
   * A plugin's private cache (ADR 0138): kept by the host outside every workspace, keyed by
   * the plugin and a key it chose, each entry dated by the host. Every member is called
   * with a key and bytes already checked; a host without them answers `E_PLUGIN_CACHE`.
   */
  /** The entry, or `undefined` when there is none. */
  cacheGet?(plugin: string, key: string): Promise<PluginCacheEntry | undefined>;
  /** Stores an entry, replacing one under the same key, and says when. */
  cachePut?(plugin: string, key: string, bytes: Uint8Array): Promise<PluginCacheStored>;
  /** Forgets an entry; `true` when there was one. */
  cacheDelete?(plugin: string, key: string): Promise<boolean>;
  /** Every entry whose key begins with `prefix`; `''` lists them all. */
  cacheList?(plugin: string, prefix: string): Promise<readonly PluginCacheListing[]>;

  /*
   * The open workspace's files (ADR 0138), at a path relative to the folder and already
   * checked lexically. **The adapter confines it again after `realpath`, reads the folder and
   * its trust on every call, and refuses writes into `.tyto/`**: those answers are the
   * adapter's, because only it can see the disk. A host without them answers
   * `E_WORKSPACE_FILE`.
   */
  /** The file's bytes. */
  workspaceRead?(plugin: string, path: string): Promise<Uint8Array>;
  /** Writes the file whole, creating its folders, replacing one that is there. */
  workspaceWrite?(plugin: string, path: string, bytes: Uint8Array): Promise<void>;
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

/** `workspace:read` and `workspace:write` (ADR 0138). Neither implies the other. */
export type WorkspaceAccess = 'read' | 'write';

export function allowsWorkspace(permissions: readonly string[], access: WorkspaceAccess): boolean {
  return permissions.includes(`workspace:${access}`);
}

/** A plugin's own capabilities, checked against what it declared. */
export interface PluginCapabilities {
  fetch(url: string, init?: HostFetchInit): Promise<FetchedResponse>;
  credentials(key: string): Promise<string>;
  storeCredential(key: string, value: string): Promise<void>;
  deleteCredential(key: string): Promise<boolean>;
  cacheGet(key: string): Promise<PluginCacheEntry | undefined>;
  cachePut(key: string, bytes: Uint8Array): Promise<PluginCacheStored>;
  cacheDelete(key: string): Promise<boolean>;
  cacheList(prefix: string): Promise<readonly PluginCacheListing[]>;
  workspaceRead(path: string): Promise<Uint8Array>;
  workspaceWrite(path: string, bytes: Uint8Array): Promise<void>;
}

/**
 * `host.cache`: a plugin's private store, kept by the host outside every workspace (ADR 0138).
 * No permission, because it holds only what the plugin itself put there, and it works in a
 * restricted folder for the same reason.
 */
export interface HostCache {
  /** The entry and when the host stored it, or `undefined` when there is none. */
  get(key: string): Promise<PluginCacheEntry | undefined>;
  /** Stores bytes, or a string as UTF-8, replacing any entry under the key. */
  put(key: string, value: Uint8Array | string): Promise<PluginCacheStored>;
  /** Forgets an entry; `true` when there was one to forget. */
  delete(key: string): Promise<boolean>;
  /** The entries whose key begins with `prefix`, every one when it is left out. */
  list(prefix?: string): Promise<readonly PluginCacheListing[]>;
}

/**
 * `host.workspace`: the open folder's files, at a path relative to it, through the host
 * (ADR 0138). `workspace:read` and `workspace:write` in the manifest; a restricted folder
 * answers `E_WORKSPACE_FILE_RESTRICTED`.
 */
export interface HostWorkspace {
  read(path: string): Promise<Uint8Array>;
  /** Writes bytes, or a string as UTF-8; resolves to `null`. Never into `.tyto/`. */
  write(path: string, value: Uint8Array | string): Promise<null>;
}

/**
 * Bytes, from what a plugin may hand `put` or `write`: a string is its UTF-8. Anything else is
 * the plugin's mistake, refused where it made it rather than after it crossed.
 */
export function bytesOf(value: Uint8Array | string): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  throw new TypeError('expected a Uint8Array or a string.');
}

/** The `host.cache` both sides of the isolation boundary hand a plugin. */
export function hostCache(
  checked: Pick<PluginCapabilities, 'cacheGet' | 'cachePut' | 'cacheDelete' | 'cacheList'>,
): HostCache {
  return {
    get: (key) => checked.cacheGet(key),
    put: async (key, value) => checked.cachePut(key, bytesOf(value)),
    delete: (key) => checked.cacheDelete(key),
    list: (prefix = '') => checked.cacheList(prefix),
  };
}

/** The `host.workspace` both sides of the isolation boundary hand a plugin. */
export function hostWorkspace(
  checked: Pick<PluginCapabilities, 'workspaceRead' | 'workspaceWrite'>,
): HostWorkspace {
  return {
    read: (path) => checked.workspaceRead(path),
    write: async (path, value) => {
      await checked.workspaceWrite(path, bytesOf(value));
      return null;
    },
  };
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

    async cacheGet(key) {
      const refused = cacheKeyProblem(key);
      if (refused !== undefined) return refuse(cacheRefusal(plugin, key, refused));
      if (capabilities?.cacheGet === undefined) {
        return refuse(cacheRefusal(plugin, key, noCache(capabilities)));
      }
      const entry = await capabilities.cacheGet(plugin, key);
      // The adapter checks the ceiling too; this is the line a misbehaving one cannot cross.
      if (entry !== undefined && entry.bytes.length > PLUGIN_FILE_LIMIT_BYTES) {
        return refuse(cacheRefusal(plugin, key, overCeiling('entry', entry.bytes.length)));
      }
      return entry;
    },

    async cachePut(key, bytes) {
      const refused = cacheKeyProblem(key);
      if (refused !== undefined) return refuse(cacheRefusal(plugin, key, refused));
      if (bytes.length > PLUGIN_FILE_LIMIT_BYTES) {
        return refuse(cacheRefusal(plugin, key, overCeiling('entry', bytes.length)));
      }
      if (capabilities?.cachePut === undefined) {
        return refuse(cacheRefusal(plugin, key, noCache(capabilities)));
      }
      return capabilities.cachePut(plugin, key, bytes);
    },

    async cacheDelete(key) {
      const refused = cacheKeyProblem(key);
      if (refused !== undefined) return refuse(cacheRefusal(plugin, key, refused));
      if (capabilities?.cacheDelete === undefined) {
        return refuse(cacheRefusal(plugin, key, noCache(capabilities)));
      }
      return capabilities.cacheDelete(plugin, key);
    },

    async cacheList(prefix) {
      // A prefix may be empty — it lists everything — and is otherwise held to a key's ceiling.
      const refused = prefix === '' ? undefined : cacheKeyProblem(prefix);
      if (refused !== undefined) return refuse(cacheRefusal(plugin, prefix, refused));
      if (capabilities?.cacheList === undefined) {
        return refuse(cacheRefusal(plugin, prefix, noCache(capabilities)));
      }
      return capabilities.cacheList(plugin, prefix);
    },

    async workspaceRead(path) {
      if (!allowsWorkspace(permissions, 'read')) {
        return refuse(
          diagnostic('E_PERMISSION', {
            plugin,
            capability: `host.workspace.read('${path}') (workspace:read)`,
          }),
        );
      }
      const relative = workspacePath(path, 'read');
      if (typeof relative !== 'string') return refuse(workspaceRefusal(plugin, path, relative));
      if (capabilities?.workspaceRead === undefined) {
        return refuse(workspaceRefusal(plugin, path, noWorkspace(capabilities)));
      }
      const bytes = await capabilities.workspaceRead(plugin, relative);
      if (bytes.length > PLUGIN_FILE_LIMIT_BYTES) {
        return refuse(workspaceRefusal(plugin, path, overCeiling('file', bytes.length)));
      }
      return bytes;
    },

    async workspaceWrite(path, bytes) {
      if (!allowsWorkspace(permissions, 'write')) {
        return refuse(
          diagnostic('E_PERMISSION', {
            plugin,
            capability: `host.workspace.write('${path}') (workspace:write)`,
          }),
        );
      }
      const relative = workspacePath(path, 'write');
      if (typeof relative !== 'string') return refuse(workspaceRefusal(plugin, path, relative));
      if (bytes.length > PLUGIN_FILE_LIMIT_BYTES) {
        return refuse(workspaceRefusal(plugin, path, overCeiling('file', bytes.length)));
      }
      if (capabilities?.workspaceWrite === undefined) {
        return refuse(workspaceRefusal(plugin, path, noWorkspace(capabilities)));
      }
      await capabilities.workspaceWrite(plugin, relative, bytes);
    },
  };
}

/** Why a cache key is refused, or `undefined` when it is a key. */
function cacheKeyProblem(key: string): string | undefined {
  if (typeof key !== 'string') throw new TypeError('a cache key must be a string.');
  if (key === '') return 'the key is empty';
  const bytes = credentialByteLength(key);
  if (bytes > PLUGIN_CACHE_KEY_LIMIT_BYTES) {
    return `the key is ${String(bytes)} bytes; the ceiling is ${String(PLUGIN_CACHE_KEY_LIMIT_BYTES)}`;
  }
  return undefined;
}

/** A refusal of the lexical kind, so the caller can tell it from a cleaned path. */
interface PathProblem {
  readonly problem: string;
}

/**
 * The path relative to the open folder, `/`-separated with `.` and empty segments dropped,
 * or why it is refused (ADR 0138).
 *
 * **Lexical only**, the first of ADR 0112's two checks: absolute paths, a drive, and `..`
 * leave the folder whatever the disk holds. The second — after `realpath`, so a link inside
 * the folder that lands outside is refused too — is the adapter's, because only it can see
 * the disk; so is "no folder is open" and "restricted", which it reads on every call.
 */
export function workspacePath(path: string, access: WorkspaceAccess): string | PathProblem {
  if (typeof path !== 'string') throw new TypeError('a workspace path must be a string.');
  if (path === '') return { problem: 'the path is empty' };
  // eslint-disable-next-line no-control-regex -- control characters are what this refuses
  if (/[\u0000-\u001f]/u.test(path)) return { problem: 'the path holds a control character' };
  const slashed = path.replaceAll('\\', '/');
  if (slashed.startsWith('/') || /^[a-zA-Z]:/u.test(slashed)) {
    return { problem: 'the path is absolute; it must be relative to the open folder' };
  }
  const segments = slashed.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) return { problem: 'the path leaves the folder' };
  const [first] = segments;
  if (first === undefined) return { problem: 'the path names the folder itself' };
  // Windows drops a trailing dot or space and ignores case, so `.TYTO.` is the same folder.
  if (access === 'write' && first.replace(/[. ]+$/u, '').toLowerCase() === '.tyto') {
    return { problem: 'it is inside .tyto/, which only Tyto writes' };
  }
  return segments.join('/');
}

function cacheRefusal(plugin: string, key: string, problem: string): Diagnostic {
  return diagnostic('E_PLUGIN_CACHE', { plugin, key, problem });
}

function workspaceRefusal(plugin: string, path: string, problem: string | PathProblem): Diagnostic {
  return diagnostic('E_WORKSPACE_FILE', {
    plugin,
    path,
    problem: typeof problem === 'string' ? problem : problem.problem,
  });
}

function overCeiling(what: 'entry' | 'file', bytes: number): string {
  return `the ${what} is ${String(bytes)} bytes; the ceiling is ${String(PLUGIN_FILE_LIMIT_BYTES)}`;
}

function noCache(capabilities: HostCapabilities | undefined): string {
  return `${capabilities?.hostName ?? 'this host'} keeps no cache for plugins`;
}

function noWorkspace(capabilities: HostCapabilities | undefined): string {
  return `${capabilities?.hostName ?? 'this host'} gives plugins no workspace files`;
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
