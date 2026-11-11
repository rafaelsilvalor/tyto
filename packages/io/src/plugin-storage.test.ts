import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PluginCapabilityError } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pluginDataDirectory } from './fs-plugin-store.js';
import { pluginCache } from './plugin-cache.js';
import { pluginStorage } from './plugin-storage.js';

/** A plugin's durable records on disk (ADR 0191), under its ADR 0187 data folder. */

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tyto-storage-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const codeOf = (attempt: Promise<unknown>): Promise<string> =>
  attempt.then(
    () => 'answered',
    (cause: unknown) => (cause instanceof PluginCapabilityError ? cause.code : String(cause)),
  );

describe('a plugin’s durable records', () => {
  it('reads back what was stored, after the host restarts', async () => {
    await pluginStorage({ home }).storageSet('agent', 'ledger.2026-11', '{"spentMicros":4200}');
    // A new instance is a new process of the host: nothing is held in memory.
    expect(await pluginStorage({ home }).storageGet('agent', 'ledger.2026-11')).toBe(
      '{"spentMicros":4200}',
    );
    expect(await pluginStorage({ home }).storageGet('agent', 'never-set')).toBeUndefined();
  });

  it('lives under the plugin’s data folder, outside its cache, which a wipe does not reach', async () => {
    const storage = pluginStorage({ home });
    await storage.storageSet('agent', 'ledger', '1');
    const files = await readdir(join(pluginDataDirectory(home, 'agent'), 'storage'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/u);
    await pluginCache({ home }).cachePut('agent', 'history', new Uint8Array([1]));
    await rm(join(home, 'cache'), { recursive: true, force: true });
    expect(await storage.storageGet('agent', 'ledger')).toBe('1');
  });

  it('keeps two keys that differ only by case apart, and one plugin’s records from another’s', async () => {
    const storage = pluginStorage({ home });
    await storage.storageSet('agent', 'A', '"upper"');
    await storage.storageSet('agent', 'a', '"lower"');
    await storage.storageSet('other', 'A', '"theirs"');
    expect(await storage.storageGet('agent', 'A')).toBe('"upper"');
    expect(await storage.storageGet('agent', 'a')).toBe('"lower"');
    expect(await storage.storageGet('other', 'A')).toBe('"theirs"');
  });

  it('refuses a record it cannot read rather than answering a miss', async () => {
    const storage = pluginStorage({ home });
    await storage.storageSet('agent', 'ledger', '{"spentMicros":4200}');
    const folder = join(pluginDataDirectory(home, 'agent'), 'storage');
    const [file] = await readdir(folder);
    await writeFile(join(folder, file ?? ''), '{"key":"ledger","value":', 'utf8');
    expect(await codeOf(storage.storageGet('agent', 'ledger'))).toBe('E_PLUGIN_STORAGE');
    // Another key's record under this name is not this key's.
    await writeFile(join(folder, file ?? ''), '{"key":"other","value":1}', 'utf8');
    expect(await codeOf(storage.storageGet('agent', 'ledger'))).toBe('E_PLUGIN_STORAGE');
  });

  it('forgets a record, and says whether there was one', async () => {
    const storage = pluginStorage({ home });
    await storage.storageSet('agent', 'k', 'null');
    expect(await storage.storageGet('agent', 'k')).toBe('null');
    expect(await storage.storageDelete('agent', 'k')).toBe(true);
    expect(await storage.storageDelete('agent', 'k')).toBe(false);
    expect(await storage.storageGet('agent', 'k')).toBeUndefined();
  });

  it('refuses a key or a plugin name no file may come from', async () => {
    const storage = pluginStorage({ home });
    expect(await codeOf(storage.storageSet('agent', '../escape', '1'))).toBe('E_PLUGIN_STORAGE');
    expect(await codeOf(storage.storageSet('../agent', 'k', '1'))).toBe('E_PLUGIN_STORAGE');
    expect(await codeOf(storage.storageSet('con', 'k', '1'))).toBe('E_PLUGIN_STORAGE');
  });
});
