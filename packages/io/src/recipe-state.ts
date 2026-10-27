import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import { type Diagnostic, type Result, diagnostic, err, ok } from '@tyto/core';
import type { RecipeState } from '@tyto/plugin-api';
import { z } from 'zod';

import { isMissing, realOrResolved } from './real-paths.js';
import { writeEntry } from './source-cache.js';
import { writeTurns } from './write-turns.js';

/**
 * A recipe's state between runs, kept by the host on this machine (ADR 0140).
 *
 * `TYTO_HOME/state/recipes/<identity>/<store>.json` holds one store as
 * `{ version: 1, entries: { <key>: { values, storedAt } } }`. **The identity is the recipe's
 * path**: the SHA-256 of the workspace's real path, a newline, and the recipe's path relative
 * to that folder with `/` between its parts. The workspace is in it because the same recipe
 * path in two checkouts is two flows, each with its own memory; the relative path is in it
 * because two recipes in one folder are two flows. `realpath` makes a link to the folder the
 * same flow as the folder, and `/` makes the identity the same on every system. Renaming or
 * moving the recipe, or the folder, starts from no state: ADR 0140 decision 3 accepts that,
 * because the first-run rule is the cautious one. The newline cannot be in a path, so no two
 * pairs hash the same text. Hashing keeps any path a valid folder name and keeps a store's
 * file out of the workspace.
 *
 * **A store never written is empty; a store that cannot be read is an error**, never empty.
 * Reading a corrupt file as no state would make the next run a first run without saying so,
 * which ADR 0140 decision 6 refuses. Every failure is `E_RECIPE_STATE` naming the file.
 *
 * `entries` answers the whole store, which `recall` reads (ADR 0144), under the same rule.
 *
 * `write` deletes, then merges each put's values over its key's (a stored column the put does
 * not name is kept), stamps every put with this host's clock, and replaces the file atomically:
 * written beside it and renamed into place, retried while Windows holds the old one. This
 * process's writes to one store take turns, so none loses another's update; across processes
 * the last writer wins, and there is no lock until a race is measured (decision 7).
 *
 * **The adapter does not ask about trust.** Reading is allowed in a restricted workspace, since
 * the data is the machine's; writing happens when a plan is applied, and whether that may
 * happen is the host's decision before it calls `write` (ADR 0111, ADR 0129).
 */

export interface RecipeStateOptions {
  /** `TYTO_HOME`. The stores are `state/recipes/` inside it. */
  readonly home: string;
  /** The workspace folder the recipe runs in. */
  readonly workspace: string;
  /** The recipe's file, absolute or relative to `workspace`. */
  readonly recipe: string;
  /** The host's clock; a test hands a fixed one. */
  readonly now?: () => Date;
}

/** A store's file is refused above this size, read or written. */
export const RECIPE_STATE_LIMIT_BYTES = 32 * 1024 * 1024;

/** A store's name as `last` and `remember` accept it (ADR 0140 decision 2): a plain word. */
const STORE_NAME = /^[A-Za-z0-9][\w-]*$/u;

/** Names Windows keeps for devices whatever the case or extension; a file cannot be one. */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/iu;

type StoredEntries =
  Awaited<ReturnType<RecipeState['read']>> extends Result<infer T, unknown> ? T : never;
type StoredEntry = StoredEntries extends ReadonlyMap<string, infer E> ? E : never;
type StatePut = Parameters<RecipeState['write']>[1][number];
type CellValue = StatePut['values'][string];

const cellValue: z.ZodType<CellValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(cellValue).readonly()]),
);

const storeFileSchema = z.strictObject({
  version: z.literal(1),
  entries: z.record(
    z.string(),
    z.strictObject({ values: z.record(z.string(), cellValue), storedAt: z.string() }),
  ),
});

type StoreFile = z.infer<typeof storeFileSchema>;

/** Thrown inside the adapter and answered as the port's error. */
class StateRefusal extends Error {
  constructor(readonly found: Diagnostic) {
    super(found.message);
  }
}

function refuse(store: string, problem: string): never {
  throw new StateRefusal(diagnostic('E_RECIPE_STATE', { store, problem }));
}

function problemOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function tooLarge(file: string, size: number): string {
  return (
    `cannot be kept: ${file} would be ${String(size)} bytes; ` +
    `the ceiling is ${String(RECIPE_STATE_LIMIT_BYTES)}`
  );
}

/** What the identity hashes: the workspace's real path and the recipe's path inside it. */
async function identityOf(workspace: string, recipe: string): Promise<string> {
  const folder = await realOrResolved(workspace);
  const file = await realOrResolved(resolve(workspace, recipe));
  const inside = relative(folder, file).split(sep).join('/');
  return createHash('sha256').update(`${folder}\n${inside}`, 'utf8').digest('hex');
}

export function recipeStateStore(options: RecipeStateOptions): RecipeState {
  const now = options.now ?? (() => new Date());
  const inTurn = writeTurns();
  let folder: Promise<string> | undefined;

  /** The recipe's folder of stores, worked out once: the paths do not move during a run. */
  function folderOf(): Promise<string> {
    folder ??= identityOf(options.workspace, options.recipe).then((identity) =>
      join(options.home, 'state', 'recipes', identity),
    );
    return folder;
  }

  async function fileOf(store: string): Promise<string> {
    if (!STORE_NAME.test(store) || WINDOWS_DEVICE.test(store)) {
      refuse(
        store,
        'is not a name a store can have: a letter or digit, then letters, digits, _ or -',
      );
    }
    return join(await folderOf(), `${store}.json`);
  }

  /** The store's file, or an empty store when it was never written. */
  async function load(store: string, file: string): Promise<StoreFile> {
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch (cause) {
      if (isMissing(cause)) return { version: 1, entries: {} };
      refuse(store, `cannot be read: ${file}: ${problemOf(cause)}`);
    }
    // On `stat` before reading, so a file somebody grew on disk is never loaded whole.
    if (size > RECIPE_STATE_LIMIT_BYTES) refuse(store, tooLarge(file, size));
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (cause) {
      refuse(store, `cannot be read: ${file}: ${problemOf(cause)}`);
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      refuse(store, `cannot be read: ${file} is not JSON; fix or delete it`);
    }
    const parsed = storeFileSchema.safeParse(value);
    if (!parsed.success) {
      refuse(store, `cannot be read: ${file} is not a version 1 store; fix or delete it`);
    }
    return parsed.data;
  }

  async function answered<T>(work: () => Promise<T>): Promise<Result<T, readonly Diagnostic[]>> {
    try {
      return ok(await work());
    } catch (cause) {
      if (cause instanceof StateRefusal) return err([cause.found]);
      throw cause;
    }
  }

  return {
    read: (store, keys) =>
      answered(async () => {
        const file = await fileOf(store);
        const { entries } = await load(store, file);
        const found = new Map<string, StoredEntry>();
        for (const key of keys) {
          const entry = Object.hasOwn(entries, key) ? entries[key] : undefined;
          if (entry !== undefined) found.set(key, entry);
        }
        return found;
      }),

    entries: (store) =>
      answered(async () => {
        const { entries } = await load(store, await fileOf(store));
        return new Map<string, StoredEntry>(Object.entries(entries));
      }),

    write: (store, puts, deletes) =>
      answered(async () => {
        const file = await fileOf(store);
        await inTurn(file, async () => {
          const { entries } = await load(store, file);
          const next = new Map(Object.entries(entries));
          for (const key of deletes) next.delete(key);
          const storedAt = now().toISOString();
          for (const put of puts) {
            next.set(put.key, {
              values: { ...next.get(put.key)?.values, ...put.values },
              storedAt,
            });
          }
          const text = JSON.stringify({ version: 1, entries: Object.fromEntries(next) });
          const bytes = Buffer.from(text, 'utf8');
          if (bytes.byteLength > RECIPE_STATE_LIMIT_BYTES) {
            refuse(store, tooLarge(file, bytes.byteLength));
          }
          try {
            await mkdir(resolve(file, '..'), { recursive: true });
            await writeEntry(file, bytes);
          } catch (cause) {
            refuse(store, `cannot be written: ${file}: ${problemOf(cause)}`);
          }
        });
      }),
  };
}
