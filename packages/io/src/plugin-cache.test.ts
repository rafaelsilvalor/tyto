import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PLUGIN_FILE_LIMIT_BYTES } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pluginCache } from './plugin-cache.js';

/** A plugin's private cache under a scratch `TYTO_HOME` (ADR 0138), on a clock a test moves. */
let home: string;
let clock: Date;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tyto-plugin-cache-'));
  clock = new Date('2026-10-25T12:00:00.000Z');
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const cache = () => pluginCache({ home, now: () => clock });
const text = (value: string) => new TextEncoder().encode(value);
const nameOf = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');
const folderOf = (plugin: string) => join(home, 'cache', 'plugins', plugin);

/** The code a refused call threw. */
async function codeOf(attempt: Promise<unknown>): Promise<string> {
  return attempt.then(
    () => 'resolved',
    (cause: unknown) => (cause as { code?: string }).code ?? String(cause),
  );
}

describe('pluginCache', () => {
  it("puts, gets, lists and deletes an entry, dated by the host's clock", async () => {
    const ports = cache();
    expect(await ports.cachePut('jira', 'issues/TYTO-1', text('{"a":1}'))).toEqual({
      storedAt: '2026-10-25T12:00:00.000Z',
    });

    const entry = await ports.cacheGet('jira', 'issues/TYTO-1');
    expect(new TextDecoder().decode(entry?.bytes)).toBe('{"a":1}');
    expect(entry?.storedAt).toBe('2026-10-25T12:00:00.000Z');
    expect(await ports.cacheList('jira', '')).toEqual([
      { key: 'issues/TYTO-1', storedAt: '2026-10-25T12:00:00.000Z', size: 7 },
    ]);

    expect(await ports.cacheDelete('jira', 'issues/TYTO-1')).toBe(true);
    expect(await ports.cacheGet('jira', 'issues/TYTO-1')).toBeUndefined();
    expect(await ports.cacheDelete('jira', 'issues/TYTO-1')).toBe(false);
    expect(await ports.cacheList('jira', '')).toEqual([]);
  });

  it('names files by the hash of the key, never by the key', async () => {
    await cache().cachePut('jira', '../../escape', text('x'));
    const name = nameOf('../../escape');
    expect((await readdir(folderOf('jira'))).sort()).toEqual([`${name}.bin`, `${name}.json`]);
    expect(JSON.parse(await readFile(join(folderOf('jira'), `${name}.json`), 'utf8'))).toEqual({
      key: '../../escape',
      storedAt: '2026-10-25T12:00:00.000Z',
      size: 1,
    });
  });

  it('replaces an entry put again under the same key, with the new date', async () => {
    const ports = cache();
    await ports.cachePut('jira', 'k', text('old'));
    clock = new Date('2026-10-26T08:30:00.000Z');
    await ports.cachePut('jira', 'k', text('newer'));
    const entry = await ports.cacheGet('jira', 'k');
    expect(new TextDecoder().decode(entry?.bytes)).toBe('newer');
    expect(entry?.storedAt).toBe('2026-10-26T08:30:00.000Z');
    expect(await ports.cacheList('jira', '')).toHaveLength(1);
  });

  it('lists by prefix, sorted by key, and keeps plugins apart', async () => {
    const ports = cache();
    await ports.cachePut('jira', 'issues/2', text('b'));
    await ports.cachePut('jira', 'issues/1', text('a'));
    await ports.cachePut('jira', 'boards/1', text('c'));
    await ports.cachePut('drive', 'issues/9', text('d'));
    expect((await ports.cacheList('jira', 'issues/')).map((entry) => entry.key)).toEqual([
      'issues/1',
      'issues/2',
    ]);
    expect(await ports.cacheGet('drive', 'issues/1')).toBeUndefined();
    expect(await ports.cacheList('other', '')).toEqual([]);
  });

  // A run killed between the two renames, or a sidecar edited by hand: a miss, never a guess.
  it('answers a miss for bytes whose sidecar is missing, corrupt, or disagrees on size', async () => {
    const ports = cache();
    for (const key of ['no-sidecar', 'corrupt', 'wrong-size', 'other-key']) {
      await ports.cachePut('jira', key, text('bytes'));
    }
    const sidecar = (key: string) => join(folderOf('jira'), `${nameOf(key)}.json`);
    await rm(sidecar('no-sidecar'));
    await writeFile(sidecar('corrupt'), '{ not json');
    await writeFile(
      sidecar('wrong-size'),
      JSON.stringify({ key: 'wrong-size', storedAt: 'x', size: 99 }),
    );
    await writeFile(
      sidecar('other-key'),
      JSON.stringify({ key: 'someone-else', storedAt: 'x', size: 5 }),
    );

    for (const key of ['no-sidecar', 'corrupt', 'wrong-size', 'other-key']) {
      expect(await ports.cacheGet('jira', key)).toBeUndefined();
    }
    expect(await ports.cacheList('jira', '')).toEqual([]);
    // Delete still clears what is there, and says there was something.
    expect(await ports.cacheDelete('jira', 'no-sidecar')).toBe(true);
    expect(await readdir(folderOf('jira'))).not.toContain(`${nameOf('no-sidecar')}.bin`);
  });

  it('refuses an empty key, an oversized key, an entry over 32 MiB and an odd plugin name', async () => {
    const ports = cache();
    expect(await codeOf(ports.cachePut('jira', '', text('x')))).toBe('E_PLUGIN_CACHE');
    expect(await codeOf(ports.cacheGet('jira', 'k'.repeat(1025)))).toBe('E_PLUGIN_CACHE');
    expect(
      await codeOf(ports.cachePut('jira', 'big', new Uint8Array(PLUGIN_FILE_LIMIT_BYTES + 1))),
    ).toBe('E_PLUGIN_CACHE');
    expect(await codeOf(ports.cachePut('../jira', 'k', text('x')))).toBe('E_PLUGIN_CACHE');
    expect(await codeOf(ports.cachePut('con', 'k', text('x')))).toBe('E_PLUGIN_CACHE');
    // An empty prefix lists everything; an oversized one is refused.
    expect(await ports.cacheList('jira', '')).toEqual([]);
    expect(await codeOf(ports.cacheList('jira', 'p'.repeat(1025)))).toBe('E_PLUGIN_CACHE');
  });
});
