import { type Diagnostic, diagnostic } from '@tyto/core';

/**
 * `host.storage`: a plugin's durable records, kept by the host under the plugin's data folder
 * (ADR 0191, under ADR 0187's root). Unlike `host.cache` (ADR 0138), a record is never a copy of
 * something the plugin can fetch again: it is the plugin's own state — what a person spent this
 * month, say — so it survives restarts, updates and a wiped cache, and goes only when the plugin
 * is removed.
 *
 * **Small and JSON.** A record is a JSON value of at most {@link PLUGIN_STORAGE_VALUE_LIMIT_BYTES}
 * as UTF-8 JSON text, under a key of 1 to {@link PLUGIN_STORAGE_KEY_LIMIT} characters from
 * `A–Z a–z 0–9 _ . -`. No permission: it holds only what the plugin put there, as the cache.
 */

/** The largest record, as UTF-8 JSON text: a ledger or a settings object, not a file store. */
export const PLUGIN_STORAGE_VALUE_LIMIT_BYTES = 64 * 1024;

/** The longest key, in characters, all ASCII. */
export const PLUGIN_STORAGE_KEY_LIMIT = 128;

const KEY = /^[A-Za-z0-9_.-]+$/u;

/** Why a key is refused, or `undefined`. */
export function storageKeyProblem(key: string): string | undefined {
  if (key === '') return 'the key is empty';
  if (key.length > PLUGIN_STORAGE_KEY_LIMIT) {
    return `the key is ${String(key.length)} characters; the ceiling is ${String(PLUGIN_STORAGE_KEY_LIMIT)}`;
  }
  if (!KEY.test(key)) return 'the key holds a character other than A–Z, a–z, 0–9, _, . or -';
  return undefined;
}

/**
 * Why a value is not JSON that reads back as itself, or `undefined`: plain objects, arrays,
 * strings, finite numbers, booleans and `null`. `JSON.stringify` would turn `NaN` into `null` and
 * drop an `undefined` field without a word, and a record that reads back different from what
 * was stored is worse than a refusal.
 */
export function jsonSafeProblem(value: unknown, path = 'the value', depth = 0): string | undefined {
  if (depth > 64) return `${path} nests deeper than 64 levels`;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? undefined
      : `${path} is ${String(value)}, which JSON cannot hold`;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const problem = jsonSafeProblem(item, `${path}[${String(index)}]`, depth + 1);
      if (problem !== undefined) return problem;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      return `${path} is not a plain object`;
    }
    for (const [name, item] of Object.entries(value)) {
      const problem = jsonSafeProblem(item, `${path}.${name}`, depth + 1);
      if (problem !== undefined) return problem;
    }
    return undefined;
  }
  return `${path} is ${typeof value === 'undefined' ? 'undefined' : `a ${typeof value}`}, which JSON cannot hold`;
}

export function storageRefusal(plugin: string, key: string, problem: string): Diagnostic {
  return diagnostic('E_PLUGIN_STORAGE', { plugin, key, problem });
}

/** `host.storage`, as a plugin reaches it. */
export interface HostStorage {
  /** The record under `key`, as stored, or `undefined` when there is none. */
  get(key: string): Promise<unknown>;
  /** Stores a JSON value under `key`, replacing any record there, all at once. */
  set(key: string, value: unknown): Promise<void>;
  /** Forgets the record; `true` when there was one. */
  delete(key: string): Promise<boolean>;
}

/** The checked calls `host.storage` is built from, on either side of the isolation boundary. */
export interface StorageCalls {
  storageGet(key: string): Promise<unknown>;
  storageSet(key: string, value: unknown): Promise<void>;
  storageDelete(key: string): Promise<boolean>;
}

export function hostStorage(checked: StorageCalls): HostStorage {
  return {
    get: (key) => checked.storageGet(key),
    set: (key, value) => checked.storageSet(key, value),
    delete: (key) => checked.storageDelete(key),
  };
}
