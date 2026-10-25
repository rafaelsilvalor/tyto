import {
  type Diagnostic,
  type Err,
  type Result,
  type SourceRange,
  diagnostic,
  err,
  ok,
} from '@tyto/core';

import type { NamedArgument } from './ast.js';
import { resolveColumn } from './columns.js';
import type { VerbContext, VerbResult } from './registry.js';
import type { RecipeState, StateWrite, StoredEntry } from './state.js';
import {
  type Problems,
  argumentsProblem,
  columnNames,
  locate,
  namedValueOffset,
  refuseNamed,
  requireTable,
  rowFilter,
} from './support.js';
import { type CellValue, type Column, type Row, type Table, cellText } from './table.js';

/** A store's name becomes a file's name on the host, so it is a plain word. */
const STORE_NAME = /^[A-Za-z0-9][\w-]*$/u;
const COLUMN_NAME = /^[A-Za-z_][\w-]*$/u;
const DEFAULT_PREFIX = 'last_';

/**
 * `last <store> [by=<column>] [columns=a,b] [prefix=last_]` brings to each row what `remember`
 * stored for it after the last applied run (ADR 0140): `last_<column>` for each stored column,
 * or for the ones `columns=` lists, and `last_stored_at`, when that was. A row is found by its
 * key, or by its `by=` column's value; a row with no entry, a first run among them, reads null
 * in every one of those columns, which is what lets a sync tell "nothing known" from a value.
 *
 * A host that keeps no state is an error and never an empty store: a recipe that read nothing
 * as "first run" every time would let one side win forever.
 */
export async function last(context: VerbContext): Promise<VerbResult> {
  const named = refuseNamed(context, ['by', 'columns', 'prefix']);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);

  const store = storeName(context, 'last <store> [by=<column>] [columns=a,b] [prefix=last_]');
  if (!store.ok) return store;
  const written = once(context);
  if (!written.ok) return written;

  const prefixArgument = written.value.get('prefix');
  const prefix = prefixArgument?.value ?? DEFAULT_PREFIX;
  if (!COLUMN_NAME.test(prefix)) {
    return argumentsProblem(
      context,
      `prefixes with letters, digits, - and _, starting with a letter or _, not '${prefix}'`,
      prefixArgument === undefined ? undefined : at(prefixArgument.range),
    );
  }
  const keyOf = rowKeyOf(context, table.value, written.value.get('by'));
  if (!keyOf.ok) return keyOf;
  const columnsArgument = written.value.get('columns');
  const listed = columnsArgument === undefined ? undefined : columnNames([columnsArgument]);
  if (listed !== undefined && listed.length === 0) {
    return argumentsProblem(context, 'lists at least one column in columns=');
  }
  for (const name of listed ?? []) {
    if (!COLUMN_NAME.test(name.value)) {
      return argumentsProblem(
        context,
        `cannot read a stored column named '${name.value}'`,
        at(name.range),
      );
    }
  }

  const state = requireState(context, store.value);
  if (!state.ok) return state;
  const keys = [...new Set(table.value.rows.map(keyOf.value).filter(isKey))];
  const read = await state.value.read(store.value, keys);
  if (!read.ok) return err(atStep(context, read.error));
  const entries = read.value;

  const storedNames =
    listed?.map((name) => name.value) ??
    [...new Set([...entries.values()].flatMap((entry) => Object.keys(entry.values)))].sort();
  const added: Column[] = [
    ...storedNames.map((name) => ({
      name: `${prefix}${name}`,
      type: table.value.columns.find((column) => column.name === name)?.type ?? 'text',
      origin: `last ${store.value}`,
    })),
    { name: `${prefix}stored_at`, type: 'datetime', origin: `last ${store.value}` },
  ];
  const clash = collision(table.value, added);
  if (clash !== undefined) {
    return argumentsProblem(
      context,
      `would add ${clash}, which the table already has or adds twice; choose another prefix ` +
        `than '${prefix}'`,
      prefixArgument === undefined ? undefined : at(prefixArgument.range),
    );
  }

  const rows = table.value.rows.map((row): Row => {
    const key = keyOf.value(row);
    const entry = key === undefined ? undefined : entries.get(key);
    const values: Record<string, CellValue> = {};
    storedNames.forEach((name, index) => {
      values[added[index]?.name ?? ''] = entry === undefined ? null : storedValue(entry, name);
    });
    values[`${prefix}stored_at`] = entry?.storedAt ?? null;
    return { ...row, values: { ...row.values, ...values } };
  });
  return ok({ table: { columns: [...table.value.columns, ...added], rows } });
}

/**
 * `remember <store> columns=a,b [by=<column>] [when="<where>"] [forget-when="<where>"]` asks
 * for each row's listed values to be stored under its key, merged into what the key holds. It
 * writes nothing during the run: the writes ride the run's result, and the host commits only
 * the rows an applied plan did not fail on (ADR 0140, `stateToCommit`). `when=` leaves the
 * rows it rejects alone; `forget-when=` deletes the entries of the rows it keeps, which is the
 * only pruning there is. The table passes through unchanged.
 */
export function remember(context: VerbContext): VerbResult {
  const named = refuseNamed(context, ['columns', 'by', 'when', 'forget-when']);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);

  const store = storeName(
    context,
    'remember <store> columns=a,b [by=<column>] [when="<where>"] [forget-when="<where>"]',
  );
  if (!store.ok) return store;
  const written = once(context);
  if (!written.ok) return written;
  const columnsArgument = written.value.get('columns');
  if (columnsArgument === undefined) return argumentsProblem(context, 'needs columns=');

  const columns: Column[] = [];
  for (const name of columnNames([columnsArgument])) {
    const column = resolveColumn(table.value, name.value, at(name.range), context.aliases);
    if (!column.ok) return column;
    if (!columns.includes(column.value)) columns.push(column.value);
  }
  if (columns.length === 0) {
    return argumentsProblem(
      context,
      'lists at least one column in columns=',
      at(columnsArgument.range),
    );
  }
  const keyOf = rowKeyOf(context, table.value, written.value.get('by'));
  if (!keyOf.ok) return keyOf;
  const when = filterOf(context, table.value, written.value.get('when'));
  if (!when.ok) return when;
  const forgetWhen = filterOf(context, table.value, written.value.get('forget-when'));
  if (!forgetWhen.ok) return forgetWhen;
  const state = requireState(context, store.value);
  if (!state.ok) return state;

  const remembers: StateWrite[] = [];
  for (const row of table.value.rows) {
    const key = keyOf.value(row);
    if (key === undefined) continue;
    const base = { store: store.value, rowKey: row.key, key };
    if (forgetWhen.value?.(row) === true) {
      remembers.push({ kind: 'forget', ...base });
    } else if (when.value === undefined || when.value(row)) {
      const values = Object.fromEntries(
        columns.map((column) => [column.name, row.values[column.name] ?? null]),
      );
      remembers.push({ kind: 'put', ...base, values });
    }
  }
  return ok({ table: table.value, remembers });
}

function storeName(context: VerbContext, usage: string): Result<string, Problems> {
  const [store, extra] = context.step.positional;
  if (store === undefined || extra !== undefined || !STORE_NAME.test(store.value)) {
    return refusal(
      context,
      `takes one store name of letters, digits, - and _, as in ${usage}`,
      store === undefined ? undefined : locate(context)(store.range),
    );
  }
  return ok(store.value);
}

/** {@link argumentsProblem}, typed for a helper that answers something other than a table. */
function refusal(context: VerbContext, problem: string, range?: SourceRange): Err<Problems> {
  return err([
    diagnostic(
      'E_RECIPE_ARGUMENTS',
      { verb: context.step.verb, problem },
      { range: range ?? context.written.textRange },
    ),
  ]);
}

/** The named arguments by name, refusing one written twice. */
function once(context: VerbContext): Result<ReadonlyMap<string, NamedArgument>, Problems> {
  const written = new Map<string, NamedArgument>();
  for (const argument of context.step.named) {
    if (written.has(argument.name)) {
      return refusal(
        context,
        `was given '${argument.name}=' twice`,
        locate(context)(argument.range),
      );
    }
    written.set(argument.name, argument);
  }
  return ok(written);
}

/** A row's key in the store: its own key, or its `by=` column's text; none when empty. */
function rowKeyOf(
  context: VerbContext,
  table: Table,
  by: NamedArgument | undefined,
): Result<(row: Row) => string | undefined, Problems> {
  if (by === undefined) return ok((row) => row.key);
  const column = resolveColumn(table, by.value, locate(context)(by.range), context.aliases);
  if (!column.ok) return column;
  return ok((row) => {
    const text = cellText(row.values[column.value.name]).trim();
    return text === '' ? undefined : text;
  });
}

function filterOf(
  context: VerbContext,
  table: Table,
  argument: NamedArgument | undefined,
): Result<((row: Row) => boolean) | undefined, Problems> {
  if (argument === undefined) return ok(undefined);
  return rowFilter(context, table, argument.value, namedValueOffset(argument));
}

function requireState(context: VerbContext, store: string): Result<RecipeState, Problems> {
  if (context.state !== undefined) return ok(context.state);
  return err([
    diagnostic(
      'E_RECIPE_STATE',
      { store, problem: 'cannot be used: this host keeps no recipe state between runs' },
      { range: context.written.verbRange },
    ),
  ]);
}

/** The port's diagnostics carry no range; they belong to the line that asked. */
function atStep(context: VerbContext, problems: readonly Diagnostic[]): Problems {
  return problems.map((problem) =>
    problem.range === undefined ? { ...problem, range: context.written.textRange } : problem,
  );
}

function isKey(key: string | undefined): key is string {
  return key !== undefined;
}

/** A stored column read without regard to case, as every column name is. */
function storedValue(entry: StoredEntry, name: string): CellValue {
  const wanted = name.toLowerCase();
  const found = Object.keys(entry.values).find((stored) => stored.toLowerCase() === wanted);
  return found === undefined ? null : (entry.values[found] ?? null);
}

/** The first added name that the table has, or that `added` repeats, ignoring case. */
function collision(table: Table, added: readonly Column[]): string | undefined {
  const seen = new Set(table.columns.map((column) => column.name.toLowerCase()));
  for (const column of added) {
    const name = column.name.toLowerCase();
    if (seen.has(name)) return column.name;
    seen.add(name);
  }
  return undefined;
}
