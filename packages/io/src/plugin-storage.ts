import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type HostCapabilities,
  PLUGIN_STORAGE_VALUE_LIMIT_BYTES,
  PluginCapabilityError,
  storageKeyProblem,
} from '@tyto/plugin-api';
import { diagnostic } from '@tyto/core';

import { pluginDataDirectory } from './fs-plugin-store.js';
import { isMissing } from './real-paths.js';
import { writeEntry } from './source-cache.js';
import { writeTurns } from './write-turns.js';

/**
 * A plugin's durable records (ADR 0191), under the data folder ADR 0187 gives it:
 * `<home>/data/plugins/<plugin>/storage/<sha256(key)>.json`, each file `{ key, value }`.
 *
 * **Under the data root, not the cache**, so an update keeps it and a wiped cache does not
 * touch it; `fsPluginStore.remove` deletes the whole data folder with the plugin. **The key never
 * names a file**: hashed, so `A` and `a` stay two records on a file system that ignores case, and
 * no key names a device on Windows.
 *
 * **A record is written beside its name and renamed into place**, so a run killed mid-write
 * leaves the old record or the new one, never half of either. **A file that exists and cannot be
 * read as a record is refused, not answered as missing**: a missing record reads as nothing, and
 * a plugin that keeps a ledger there would read a corrupt one as an empty month. Writes to one
 * key from this host run in turn.
 */

export interface PluginStorageOptions {
  /** `TYTO_HOME`. */
  readonly home: string;
}

export type PluginStoragePorts = Required<
  Pick<HostCapabilities, 'storageGet' | 'storageSet' | 'storageDelete'>
>;

function refuse(plugin: string, key: string, problem: string): never {
  throw new PluginCapabilityError(diagnostic('E_PLUGIN_STORAGE', { plugin, key, problem }));
}

function nameOf(key: string): string {
  return `${createHash('sha256').update(key, 'utf8').digest('hex')}.json`;
}

export function pluginStorage(options: PluginStorageOptions): PluginStoragePorts {
  const inTurn = writeTurns();

  /** The record's file, once the plugin's name and the key are ones a file can come from. */
  function fileOf(plugin: string, key: string): { readonly folder: string; readonly file: string } {
    const problem = storageKeyProblem(key);
    if (problem !== undefined) refuse(plugin, key, problem);
    let data: string;
    try {
      data = pluginDataDirectory(options.home, plugin);
    } catch {
      refuse(plugin, key, 'the plugin name is not one a data folder can be named after');
    }
    const folder = join(data, 'storage');
    return { folder, file: join(folder, nameOf(key)) };
  }

  return {
    async storageGet(plugin, key) {
      const { file } = fileOf(plugin, key);
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch (cause) {
        if (isMissing(cause)) return undefined;
        refuse(plugin, key, `the record could not be read (${(cause as Error).message})`);
      }
      let record: { key?: unknown; value?: unknown };
      try {
        record = JSON.parse(text) as { key?: unknown; value?: unknown };
      } catch {
        refuse(plugin, key, 'the record on disk is not JSON');
      }
      if (record.key !== key || !('value' in record)) {
        refuse(plugin, key, 'the file on disk is not this key’s record');
      }
      return JSON.stringify(record.value);
    },

    async storageSet(plugin, key, json) {
      const { folder, file } = fileOf(plugin, key);
      // Checked by plugin-api already; again here, because an adapter is also called in process.
      if (Buffer.byteLength(json, 'utf8') > PLUGIN_STORAGE_VALUE_LIMIT_BYTES) {
        refuse(plugin, key, 'the record is over the ceiling');
      }
      let value: unknown;
      try {
        value = JSON.parse(json);
      } catch {
        refuse(plugin, key, 'the record is not JSON');
      }
      const bytes = Buffer.from(JSON.stringify({ key, value }), 'utf8');
      await inTurn(file, async () => {
        await mkdir(folder, { recursive: true });
        await writeEntry(file, bytes);
      });
    },

    async storageDelete(plugin, key) {
      const { file } = fileOf(plugin, key);
      return inTurn(file, async () => {
        try {
          await readFile(file);
        } catch (cause) {
          if (isMissing(cause)) return false;
        }
        await rm(file, { force: true });
        return true;
      });
    },
  };
}
