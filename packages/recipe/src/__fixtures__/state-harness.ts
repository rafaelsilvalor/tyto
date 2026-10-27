import { type Diagnostic, err, ok } from '@tyto/core';

import type { RunClock } from '../clock.js';
import { parseRecipe } from '../parse.js';
import { createDerivationRegistry, createVerbRegistry } from '../registry.js';
import { type RecipeRun, runRecipe } from '../run.js';
import type { RecipeState, StoredEntry } from '../state.js';
import type { CellValue, Table } from '../table.js';

export const STORED_AT = '2026-10-25T12:00:00.000Z';

/** An in-memory store with the port's merge rule, standing in for the host's (PR4). */
export function memoryState(
  initial: Record<string, Record<string, Record<string, CellValue>>> = {},
): RecipeState & { readonly stores: Map<string, Map<string, StoredEntry>> } {
  const stores = new Map<string, Map<string, StoredEntry>>(
    Object.entries(initial).map(([store, entries]) => [
      store,
      new Map(
        Object.entries(entries).map(([key, values]) => [key, { values, storedAt: STORED_AT }]),
      ),
    ]),
  );
  return {
    stores,
    read: (store, keys) => {
      const entries = stores.get(store) ?? new Map<string, StoredEntry>();
      const found = new Map<string, StoredEntry>();
      for (const key of keys) {
        const entry = entries.get(key);
        if (entry !== undefined) found.set(key, entry);
      }
      return Promise.resolve(ok(found));
    },
    entries: (store) => Promise.resolve(ok(new Map(stores.get(store) ?? []))),
    write: (store, puts, deletes) => {
      const entries = stores.get(store) ?? new Map<string, StoredEntry>();
      stores.set(store, entries);
      for (const key of deletes) entries.delete(key);
      for (const put of puts) {
        const values = { ...entries.get(put.key)?.values, ...put.values };
        entries.set(put.key, { values, storedAt: STORED_AT });
      }
      return Promise.resolve(ok(undefined));
    },
  };
}

export interface Ran {
  readonly run: RecipeRun;
  readonly table: Table | undefined;
  readonly errors: readonly Diagnostic[];
  readonly at: string | undefined;
}

/** What else a run may be given: its clock (ADR 0139) and the workspace's data files. */
export interface RunExtras {
  readonly clock?: RunClock;
  readonly files?: Record<string, unknown>;
}

export async function runWithState(
  lines: readonly string[],
  input: Table,
  state: RecipeState | undefined,
  included: Record<string, string> = {},
  extras: RunExtras = {},
): Promise<Ran> {
  const files = extras.files ?? {};
  const source = ['recipe sync', ...lines].join('\n');
  const recipe = parseRecipe(source);
  if (!recipe.ok) throw new Error(recipe.error.map(({ message }) => message).join('\n'));
  const result = await runRecipe(recipe.value, {
    input,
    verbs: createVerbRegistry(),
    derivations: createDerivationRegistry(),
    resolveRecipe: (name) => {
      const text = included[name];
      if (text === undefined) return Promise.resolve(err([]));
      const parsed = parseRecipe(text);
      return Promise.resolve(parsed.ok ? ok(parsed.value) : err(parsed.error));
    },
    state,
    clock: extras.clock,
    resolveData: (path) => Promise.resolve(path in files ? ok(files[path]) : err([])),
  });
  if (!result.ok) throw new Error('the run must start');
  const errors = result.value.cells
    .flatMap((cell) => cell.diagnostics)
    .filter((found) => found.severity === 'error');
  const range = errors[0]?.range;
  return {
    run: result.value,
    table: result.value.table,
    errors,
    at: range === undefined ? undefined : source.slice(range.start, range.end),
  };
}

/** The values of `columns` on every row, in order. */
export function column(table: Table | undefined, name: string): readonly CellValue[] {
  return table?.rows.map((row) => row.values[name] ?? null) ?? [];
}
