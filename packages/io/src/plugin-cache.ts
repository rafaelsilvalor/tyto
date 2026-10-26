import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { diagnostic } from '@tyto/core';
import {
  type HostCapabilities,
  PLUGIN_CACHE_KEY_LIMIT_BYTES,
  PLUGIN_FILE_LIMIT_BYTES,
  PluginCapabilityError,
  type PluginCacheListing,
} from '@tyto/plugin-api';
import { z } from 'zod';

import { isMissing } from './real-paths.js';
import { writeEntry } from './source-cache.js';

/**
 * A plugin's private cache, kept by the host outside every workspace (ADR 0130, ADR 0138).
 *
 * `TYTO_HOME/cache/plugins/<plugin>/<sha256(key)>.bin` holds the bytes and a `.json` sidecar
 * beside it holds `{ key, storedAt, size, sha256 }`, which `list` reads without opening the
 * entries.
 * **The key never names a file**: it is the plugin's text, and hashing it keeps any key a
 * valid name on every system and keeps it from naming a path (ADR 0117 rule 4).
 *
 * **`storedAt` is this host's clock**, never the plugin's: it is what the notebook shows as a
 * table's age, and a plugin could otherwise make stale data look fresh.
 *
 * Both files are written beside their name and renamed into place, bytes first and the
 * sidecar after. **An entry whose sidecar is missing, unreadable, names another key or
 * disagrees with the bytes' size or digest is not an entry**: `get` answers a miss and `list`
 * leaves it out. `list` compares the size and not the digest, because hashing every entry is
 * the read the sidecar exists to spare; a pair a race left with equal sizes is listed and then
 * missed by `get`, as an entry deleted between the two calls would be. A sidecar from before
 * the digest is a miss: nothing tells its bytes apart from a race's. A miss is also what a run
 * killed between the two renames leaves — new bytes beside the old sidecar, or bytes with
 * none — and what two plugins' processes racing on one key can leave; a miss makes
 * the plugin ask its source again, which is the answer an empty cache gives.
 * `delete` removes both files whatever state they are in, and a `put` replaces both.
 *
 * Every refusal is `E_PLUGIN_CACHE`, thrown as `PluginCapabilityError` so it crosses the
 * isolation boundary as the plugin's own refusal. `checkedCapabilities` has refused an empty
 * key, a key over 1 KiB and an entry over 32 MiB already; the ceilings are checked here
 * again because an adapter is also called in process, and an entry on disk can be anything.
 */

export interface PluginCacheOptions {
  /** `TYTO_HOME`. The cache is `cache/plugins/<plugin>/` inside it. */
  readonly home: string;
  /** The host's clock; a test hands a fixed one. */
  readonly now?: () => Date;
}

export type PluginCachePorts = Required<
  Pick<HostCapabilities, 'cacheGet' | 'cachePut' | 'cacheDelete' | 'cacheList'>
>;

/** A plugin's name as the manifest allows it (`manifest.ts`), and so a safe folder name. */
const PLUGIN_NAME = /^[a-z0-9][a-z0-9-]*$/u;

/** Names Windows keeps for devices whatever the extension; a folder cannot be called one. */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/u;

const sidecarSchema = z.strictObject({
  key: z.string(),
  storedAt: z.string(),
  size: z.number().int().nonnegative(),
  /**
   * The bytes' SHA-256, lowercase hex. A sidecar written before it existed fails this schema,
   * and so is a miss: such an entry cannot be told apart from one a race left behind.
   */
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

/** What `list` answers for a sidecar: the digest stays on disk. */
function listingOf(sidecar: z.infer<typeof sidecarSchema>): PluginCacheListing {
  return { key: sidecar.key, storedAt: sidecar.storedAt, size: sidecar.size };
}

function refuse(plugin: string, key: string, problem: string): never {
  throw new PluginCapabilityError(diagnostic('E_PLUGIN_CACHE', { plugin, key, problem }));
}

function nameOf(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function checkKey(plugin: string, key: string, allowEmpty = false): void {
  if (key === '' && !allowEmpty) refuse(plugin, key, 'the key is empty');
  const bytes = Buffer.byteLength(key, 'utf8');
  if (bytes > PLUGIN_CACHE_KEY_LIMIT_BYTES) {
    refuse(
      plugin,
      key,
      `the key is ${String(bytes)} bytes; the ceiling is ${String(PLUGIN_CACHE_KEY_LIMIT_BYTES)}`,
    );
  }
}

function overCeiling(size: number): string {
  return `the entry is ${String(size)} bytes; the ceiling is ${String(PLUGIN_FILE_LIMIT_BYTES)}`;
}

export function pluginCache(options: PluginCacheOptions): PluginCachePorts {
  const root = join(options.home, 'cache', 'plugins');
  const now = options.now ?? (() => new Date());
  /** The last write queued per entry file, so this host's writes to one key run in turn. */
  const writing = new Map<string, Promise<unknown>>();

  /**
   * Runs `work` after every earlier write to the same entry has settled. One host serves
   * every frame of an export and every plugin process at once, and two puts of one key
   * interleaved — bytes of one, sidecar of the other — would leave a miss behind (TYTO-371).
   * Another process can still interleave with this one; the digest makes that a miss.
   */
  function inTurn<T>(entry: string, work: () => Promise<T>): Promise<T> {
    const before = writing.get(entry) ?? Promise.resolve();
    const done = before.then(work, work);
    const settled = done.then(
      () => undefined,
      () => undefined,
    );
    writing.set(entry, settled);
    void settled.then(() => {
      if (writing.get(entry) === settled) writing.delete(entry);
    });
    return done;
  }

  /** The plugin's folder, once its name is known to be a plain folder name. */
  function folderOf(plugin: string, key: string): string {
    if (!PLUGIN_NAME.test(plugin) || WINDOWS_DEVICE.test(plugin)) {
      refuse(plugin, key, 'the plugin name is not one a cache folder can be named after');
    }
    return join(root, plugin);
  }

  /** The sidecar under `name`, when it is one and describes `key`; anything else is none. */
  async function sidecarOf(
    folder: string,
    name: string,
  ): Promise<z.infer<typeof sidecarSchema> | undefined> {
    let text: string;
    try {
      text = await readFile(join(folder, `${name}.json`), 'utf8');
    } catch (cause) {
      if (isMissing(cause)) return undefined;
      throw cause;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return undefined;
    }
    const parsed = sidecarSchema.safeParse(value);
    // A sidecar copied under another entry's name is not that entry's.
    if (!parsed.success || nameOf(parsed.data.key) !== name) return undefined;
    return parsed.data;
  }

  /** The size of the bytes on disk, or `undefined` when there are none. */
  async function sizeOf(path: string): Promise<number | undefined> {
    try {
      const found = await stat(path);
      return found.isFile() ? found.size : undefined;
    } catch (cause) {
      if (isMissing(cause)) return undefined;
      throw cause;
    }
  }

  return {
    async cacheGet(plugin, key) {
      checkKey(plugin, key);
      const folder = folderOf(plugin, key);
      const name = nameOf(key);
      const sidecar = await sidecarOf(folder, name);
      if (sidecar === undefined) return undefined;
      const path = join(folder, `${name}.bin`);
      const size = await sizeOf(path);
      if (size === undefined || size !== sidecar.size) return undefined;
      // On `stat` before reading, so an entry somebody grew on disk is never loaded whole.
      if (size > PLUGIN_FILE_LIMIT_BYTES) refuse(plugin, key, overCeiling(size));
      const bytes = new Uint8Array(await readFile(path));
      if (bytes.byteLength !== sidecar.size) return undefined;
      // Two processes putting one key with bytes of one size can pair one's bytes with the
      // other's sidecar; the size cannot tell, the digest can (TYTO-371).
      if (digestOf(bytes) !== sidecar.sha256) return undefined;
      return { bytes, storedAt: sidecar.storedAt };
    },

    async cachePut(plugin, key, bytes) {
      checkKey(plugin, key);
      const folder = folderOf(plugin, key);
      if (bytes.byteLength > PLUGIN_FILE_LIMIT_BYTES) {
        refuse(plugin, key, overCeiling(bytes.byteLength));
      }
      const name = nameOf(key);
      return inTurn(join(folder, name), async () => {
        const storedAt = now().toISOString();
        await mkdir(folder, { recursive: true });
        await writeEntry(join(folder, `${name}.bin`), bytes);
        const sidecar = JSON.stringify({
          key,
          storedAt,
          size: bytes.byteLength,
          sha256: digestOf(bytes),
        });
        await writeEntry(join(folder, `${name}.json`), Buffer.from(sidecar, 'utf8'));
        return { storedAt };
      });
    },

    async cacheDelete(plugin, key) {
      checkKey(plugin, key);
      const folder = folderOf(plugin, key);
      const name = nameOf(key);
      return inTurn(join(folder, name), async () => {
        const existed =
          (await sizeOf(join(folder, `${name}.bin`))) !== undefined ||
          (await sidecarOf(folder, name)) !== undefined;
        // The sidecar first: a delete killed half way leaves bytes no sidecar describes, a miss.
        await rm(join(folder, `${name}.json`), { force: true });
        await rm(join(folder, `${name}.bin`), { force: true });
        return existed;
      });
    },

    async cacheList(plugin, prefix) {
      checkKey(plugin, prefix, true);
      const folder = folderOf(plugin, prefix);
      let names: string[];
      try {
        names = await readdir(folder);
      } catch (cause) {
        if (isMissing(cause)) return [];
        throw cause;
      }
      const listing: PluginCacheListing[] = [];
      for (const file of names) {
        if (!file.endsWith('.json')) continue;
        const name = file.slice(0, -'.json'.length);
        const sidecar = await sidecarOf(folder, name);
        if (sidecar === undefined || !sidecar.key.startsWith(prefix)) continue;
        if ((await sizeOf(join(folder, `${name}.bin`))) !== sidecar.size) continue;
        listing.push(listingOf(sidecar));
      }
      // By key, so the same cache lists the same way on every system.
      return listing.sort((left, right) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
      );
    },
  };
}
