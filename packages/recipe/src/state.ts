import { type Diagnostic, type Result } from '@tyto/core';

import type { CellValue } from './table.js';

/**
 * A recipe's state between runs (ADR 0140): what a row looked like the last time a run of this
 * recipe was applied, so a sync can tell which side changed since.
 *
 * The host builds the port for one run, bound to the workspace and the recipe it runs, and
 * keeps the stores outside the workspace, on the machine. A verb names only the store and the
 * row's key; it never sees a path, nor which recipe it belongs to. Reading is allowed in a
 * restricted workspace: the data is the machine's, not the folder's.
 */
export interface RecipeState {
  /**
   * The stored entries of `keys` in `store`. A key with no entry is absent from the map, and a
   * store never written is an empty map, not an error.
   */
  read(
    store: string,
    keys: readonly string[],
  ): Promise<Result<ReadonlyMap<string, StoredEntry>, readonly Diagnostic[]>>;
  /**
   * Removes `deletes`, then merges each put's values over what its key holds: a stored column
   * the put does not name is kept. Each put is stamped with the host clock's now.
   */
  write(
    store: string,
    puts: readonly StatePut[],
    deletes: readonly string[],
  ): Promise<Result<void, readonly Diagnostic[]>>;
}

export interface StoredEntry {
  /** By the column name `remember` read the value from. */
  readonly values: Readonly<Record<string, CellValue>>;
  /** ISO 8601, from the host's clock when the entry was last written. */
  readonly storedAt: string;
}

export interface StatePut {
  readonly key: string;
  readonly values: Readonly<Record<string, CellValue>>;
}

/**
 * What `remember` asks the host to write, which rides the run's result the way a keep does
 * (ADR 0130): a run writes no state, and only an applied plan's rows reach the store (ADR 0129).
 */
export type StateWrite =
  | {
      readonly kind: 'put';
      readonly store: string;
      /** The table row the write stands for, which a planned operation names. */
      readonly rowKey: string;
      /** The key the entry is stored under: the row's key, or a column's value with `by=`. */
      readonly key: string;
      readonly values: Readonly<Record<string, CellValue>>;
    }
  | {
      readonly kind: 'forget';
      readonly store: string;
      readonly rowKey: string;
      readonly key: string;
    };

/**
 * How an apply went, operation by operation, as much of it as deciding the state needs. The
 * apply itself is TYTO-378's, which hands this over and may add fields, never remove one.
 */
export interface ApplyOutcome {
  readonly operations: readonly AppliedOperation[];
}

export interface AppliedOperation {
  /** The row the planned operation stood for, when it stood for one. */
  readonly rowKey?: string;
  /** `skipped` is an operation an earlier failure stopped; it did not happen either. */
  readonly status: 'applied' | 'failed' | 'skipped';
}

/** One store's writes, in the shape {@link RecipeState.write} takes. */
export interface StateCommit {
  readonly store: string;
  readonly puts: readonly StatePut[];
  readonly deletes: readonly string[];
}

/**
 * What the host writes once a plan is applied (ADR 0140 decision 4). A preview, which has no
 * outcome, commits nothing. A row with an operation that did not apply keeps its old state, so
 * the next run still sees that row as changed and tries again, as Buraqueira's sync did. An
 * operation that failed and stands for no row could have touched any of them, so then nothing
 * is committed.
 *
 * Writes to one key fold in order: puts merge, a forget drops what came before it, and a put
 * after a forget starts the entry over (the key is deleted, then put).
 */
export function stateToCommit(
  remembers: readonly StateWrite[],
  outcome: ApplyOutcome | undefined,
): readonly StateCommit[] {
  if (outcome === undefined) return [];
  const unapplied = outcome.operations.filter((operation) => operation.status !== 'applied');
  if (unapplied.some((operation) => operation.rowKey === undefined)) return [];
  const failedRows = new Set(unapplied.map((operation) => operation.rowKey));

  const stores = new Map<
    string,
    Map<string, { forget: boolean; values?: Record<string, CellValue> }>
  >();
  for (const write of remembers) {
    if (failedRows.has(write.rowKey)) continue;
    const keys = stores.get(write.store) ?? new Map();
    stores.set(write.store, keys);
    const folded = keys.get(write.key) ?? { forget: false };
    if (write.kind === 'forget') {
      keys.set(write.key, { forget: true });
    } else {
      keys.set(write.key, { ...folded, values: { ...folded.values, ...write.values } });
    }
  }

  return [...stores].map(([store, keys]) => ({
    store,
    puts: [...keys]
      .filter(([, folded]) => folded.values !== undefined)
      .map(([key, folded]) => ({ key, values: folded.values ?? {} })),
    deletes: [...keys].filter(([, folded]) => folded.forget).map(([key]) => key),
  }));
}
