import { type Diagnostic, diagnostic, ok } from '@tyto/core';

import type { NamedArgument } from './ast.js';
import { resolveColumn } from './columns.js';
import type { VerbContext, VerbResult } from './registry.js';
import {
  argumentsProblem,
  columnNames,
  locate,
  namedValueOffset,
  refuseNamed,
  requireTable,
  rowFilter,
} from './support.js';
import { type CellValue, type Column, type Row, type Table, comparable } from './table.js';

const PREFIX = /^[a-z][a-z0-9_]*$/u;

/** What `<prefix>_match` says, the vocabulary a later `where copy_match = paired` filters on. */
export const JOIN_MATCH = {
  paired: 'paired',
  noKey: 'no key',
  noPair: 'no pair',
  ambiguous: (candidates: number) => `ambiguous (${candidates} candidates)`,
} as const;

/** The most rows an ambiguity warning names, as `flow.py` did; the column holds the rest. */
const NAMED_IN_WARNING = 8;

/**
 * `join <prefix> left="<where>" right="<where>" on=<column> [bring=key,status]` (ADR 0133).
 *
 * Pairs rows of the one table: each left row looks for the right row whose `on` value is its
 * own. The right side is consumed: its rows leave the table and what `bring` names becomes
 * `<prefix>_<column>` on the left row they pair with, or else every copy of a paired row would
 * appear twice. A row on neither side passes through with the new columns empty.
 *
 * The key is a column, usually one a derivation produced. A list value is several keys: a right
 * row is indexed under each, which is how one derivation offers several pairing strategies, and
 * a left row looks under each of its own. A key that answers to more than one right row never
 * pairs: the row says `ambiguous (N candidates)` and the cell warns, because picking the first
 * one would hide the decision a person has to make.
 */
export function join(context: VerbContext): VerbResult {
  const named = refuseNamed(context, ['left', 'right', 'on', 'bring']);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;

  const [prefixArgument, extra] = context.step.positional;
  if (prefixArgument === undefined || extra !== undefined) {
    return argumentsProblem(
      context,
      'takes one prefix and left=, right= and on=, as in join copy left="team = design" ' +
        'right="team = copy" on=pair_key',
    );
  }
  const prefix = prefixArgument.value;
  if (!PREFIX.test(prefix)) {
    return argumentsProblem(
      context,
      `prefixes with lower-case letters, digits and _, starting with a letter, not '${prefix}'`,
      prefixArgument.range,
    );
  }

  const written = new Map<string, NamedArgument>();
  for (const argument of context.step.named) {
    if (written.has(argument.name)) {
      return argumentsProblem(context, `takes '${argument.name}=' once`, argument.range);
    }
    written.set(argument.name, argument);
  }
  const left = written.get('left');
  const right = written.get('right');
  const on = written.get('on');
  if (left === undefined || right === undefined || on === undefined) {
    const missing = ['left', 'right', 'on'].filter((name) => !written.has(name));
    return argumentsProblem(context, `needs ${missing.map((name) => `${name}=`).join(', ')}`);
  }

  const at = locate(context);
  const keyColumn = resolveColumn(table.value, on.value, at(on.range), context.aliases);
  if (!keyColumn.ok) return keyColumn;

  const bringWritten = written.get('bring');
  const bringNames = bringWritten
    ? columnNames([bringWritten])
    : [
        { value: 'key', range: context.written.textRange },
        { value: 'status', range: context.written.textRange },
      ];
  const brought: Column[] = [];
  for (const name of bringNames) {
    const column = resolveColumn(table.value, name.value, at(name.range), context.aliases);
    if (!column.ok) return column;
    if (!brought.includes(column.value)) brought.push(column.value);
  }
  if (brought.length === 0) {
    return argumentsProblem(context, 'brings at least one column', bringWritten?.range);
  }

  const origin = `join ${prefix}`;
  const added: Column[] = [
    ...brought.map((column) => ({ name: `${prefix}_${column.name}`, type: column.type, origin })),
    { name: `${prefix}_match`, type: 'text', origin },
  ];
  const taken = added.filter((column) =>
    table.value.columns.some(
      (existing) => existing.name.toLowerCase() === column.name.toLowerCase(),
    ),
  );
  if (taken.length > 0) {
    return argumentsProblem(
      context,
      `would add ${taken.map((column) => column.name).join(', ')}, which the table already ` +
        `has; choose another prefix than '${prefix}', or a second join would overwrite the ` +
        'first in silence',
      prefixArgument.range,
    );
  }

  const isRight = rowFilter(context, table.value, right.value, namedValueOffset(right));
  if (!isRight.ok) return isRight;
  const isLeft = rowFilter(context, table.value, left.value, namedValueOffset(left));
  if (!isLeft.ok) return isLeft;

  const keyName = keyColumn.value.name;
  const rightRows = table.value.rows.filter(isRight.value);
  const index = indexByKey(rightRows, keyName);

  const ambiguous: string[] = [];
  const rows: Row[] = [];
  for (const row of table.value.rows) {
    if (isRight.value(row)) continue;
    if (!isLeft.value(row)) {
      rows.push(withColumns(row, added, () => null));
      continue;
    }
    const keys = keysOf(row.values[keyName]);
    const candidates = new Set(keys.flatMap((key) => index.get(key) ?? []));
    const [pair] = candidates;
    let match: string;
    if (keys.length === 0) match = JOIN_MATCH.noKey;
    else if (pair === undefined) match = JOIN_MATCH.noPair;
    else if (candidates.size > 1) match = JOIN_MATCH.ambiguous(candidates.size);
    else match = JOIN_MATCH.paired;
    if (candidates.size > 1) ambiguous.push(row.key);
    const partner = candidates.size === 1 ? pair : undefined;
    rows.push(
      withColumns(row, added, (position) => {
        if (position === brought.length) return match;
        const source = brought[position];
        return partner === undefined || source === undefined
          ? null
          : (partner.values[source.name] ?? null);
      }),
    );
  }

  const result: Table = { columns: [...table.value.columns, ...added], rows };
  return ok({ table: result }, ambiguityWarning(context, prefix, ambiguous));
}

/** Every key a cell offers: one for a value, one per item for a list, none for an empty cell. */
function keysOf(value: CellValue | undefined): readonly string[] {
  const items = Array.isArray(value) ? value : [value];
  const keys = items.map((item: CellValue | undefined) => comparable(item)).filter((key) => key);
  return [...new Set(keys)];
}

/**
 * Right rows by every key they offer. Keeping the list and not the first row is what lets a
 * key that answers to two rows be seen as ambiguous rather than paired with whichever came first.
 */
function indexByKey(rows: readonly Row[], keyName: string): ReadonlyMap<string, readonly Row[]> {
  const index = new Map<string, Row[]>();
  for (const row of rows) {
    for (const key of keysOf(row.values[keyName])) {
      const candidates = index.get(key) ?? [];
      candidates.push(row);
      index.set(key, candidates);
    }
  }
  return index;
}

function withColumns(
  row: Row,
  added: readonly Column[],
  value: (position: number) => CellValue,
): Row {
  return {
    ...row,
    values: {
      ...row.values,
      ...Object.fromEntries(added.map((column, position) => [column.name, value(position)])),
    },
  };
}

/**
 * One warning per cell and not one per row: the rows already say it in `<prefix>_match`, and the
 * warning is there so an ambiguity among a hundred rows cannot pass unseen.
 */
function ambiguityWarning(
  context: VerbContext,
  prefix: string,
  rows: readonly string[],
): readonly Diagnostic[] {
  if (rows.length === 0) return [];
  const named = rows.slice(0, NAMED_IN_WARNING).join(', ');
  const more = rows.length > NAMED_IN_WARNING ? ` and ${rows.length - NAMED_IN_WARNING} more` : '';
  return [
    diagnostic(
      'W_RECIPE_JOIN_AMBIGUOUS',
      { prefix, count: rows.length, rows: `${named}${more}` },
      { range: context.written.textRange },
    ),
  ];
}
