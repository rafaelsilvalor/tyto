import { describe, expect, it } from 'vitest';

import {
  type HostCapabilities,
  PluginCapabilityError,
  checkedCapabilities,
} from './capabilities.js';
import { PLUGIN_STORAGE_VALUE_LIMIT_BYTES, jsonSafeProblem, storageKeyProblem } from './storage.js';

/** `host.storage`'s checks on the host's side (ADR 0191). The files are `@tyto/io`'s, tested there. */

function store(overrides: Partial<HostCapabilities> = {}) {
  const records = new Map<string, string>();
  const capabilities: HostCapabilities = {
    hostName: 'the test host',
    fetch: () => Promise.reject(new Error('no network')),
    credential: () => Promise.resolve(undefined),
    describeCredential: () => 'nowhere',
    storageGet: (_plugin, key) => Promise.resolve(records.get(key)),
    storageSet: (_plugin, key, json) => {
      records.set(key, json);
      return Promise.resolve();
    },
    storageDelete: (_plugin, key) => Promise.resolve(records.delete(key)),
    ...overrides,
  };
  return { checked: checkedCapabilities('agent', [], capabilities), records };
}

const codeOf = (attempt: Promise<unknown>): Promise<string> =>
  attempt.then(
    () => 'answered',
    (cause: unknown) => (cause instanceof PluginCapabilityError ? cause.code : String(cause)),
  );

describe('host.storage', () => {
  it('keeps a JSON value, null included, and tells a stored null from a miss', async () => {
    const { checked } = store();
    await checked.storageSet('ledger.2026-11', { spentMicros: 1250, turns: [1, 2] });
    await checked.storageSet('nothing', null);
    expect(await checked.storageGet('ledger.2026-11')).toEqual({
      spentMicros: 1250,
      turns: [1, 2],
    });
    expect(await checked.storageGet('nothing')).toBeNull();
    expect(await checked.storageGet('never-set')).toBeUndefined();
    expect(await checked.storageDelete('nothing')).toBe(true);
    expect(await checked.storageDelete('nothing')).toBe(false);
  });

  it('refuses a key the store does not take, before the adapter is asked', async () => {
    const { checked, records } = store();
    for (const key of ['', '../ledger', 'a/b', 'é', 'x'.repeat(129)]) {
      expect(await codeOf(checked.storageSet(key, 1))).toBe('E_PLUGIN_STORAGE');
      expect(await codeOf(checked.storageGet(key))).toBe('E_PLUGIN_STORAGE');
    }
    expect(records.size).toBe(0);
    expect(storageKeyProblem('x'.repeat(128))).toBeUndefined();
  });

  it('refuses a value that would not read back as itself, or is over 64 KiB', async () => {
    const { checked, records } = store();
    for (const value of [
      Number.NaN,
      Infinity,
      undefined,
      { at: new Date(0) },
      [() => 1],
      { a: undefined },
    ]) {
      expect(await codeOf(checked.storageSet('k', value))).toBe('E_PLUGIN_STORAGE');
    }
    const big = 'x'.repeat(PLUGIN_STORAGE_VALUE_LIMIT_BYTES);
    expect(await codeOf(checked.storageSet('k', big))).toBe('E_PLUGIN_STORAGE');
    expect(records.size).toBe(0);
    // The ceiling is the JSON text: two quotes leave room for this one.
    await checked.storageSet('k', 'x'.repeat(PLUGIN_STORAGE_VALUE_LIMIT_BYTES - 2));
    expect(records.size).toBe(1);
    expect(jsonSafeProblem({ a: [1, 'b', true, null, { c: 2.5 }] })).toBeUndefined();
  });

  it('refuses a stored record that is not JSON rather than answering a miss', async () => {
    const { checked } = store({ storageGet: () => Promise.resolve('{"spent": 12') });
    expect(await codeOf(checked.storageGet('ledger'))).toBe('E_PLUGIN_STORAGE');
  });

  it('answers E_PLUGIN_STORAGE on a host that keeps no records', async () => {
    const checked = checkedCapabilities('agent', [], {
      fetch: () => Promise.reject(new Error('no network')),
      credential: () => Promise.resolve(undefined),
      describeCredential: () => 'nowhere',
    });
    expect(await codeOf(checked.storageGet('k'))).toBe('E_PLUGIN_STORAGE');
    expect(await codeOf(checked.storageSet('k', 1))).toBe('E_PLUGIN_STORAGE');
    expect(await codeOf(checked.storageDelete('k'))).toBe('E_PLUGIN_STORAGE');
  });
});
