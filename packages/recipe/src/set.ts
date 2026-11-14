import { diagnostic, err, ok } from '@tyto/core';

import { resolveColumn } from './columns.js';
import type { VerbContext, VerbResult } from './registry.js';
import { argumentsProblem, requireTable } from './support.js';
import { type CellValue, cellText, comparable } from './table.js';

/** What `set` computes from the table (TYTO-727, ADR 0199). Only `count` reads no column. */
export const SET_AGGREGATES = ['count', 'min', 'max', 'first', 'last', 'sum'] as const;

export type SetAggregate = (typeof SET_AGGREGATES)[number];

/** `set <name> = <aggregate> [column]`, read from a step's text. */
export interface SetStep {
  readonly name: string;
  readonly aggregate: string;
  /** The column as written, without its quotes; absent for `count`. */
  readonly column?: string;
}

/**
 * `last_due = max due` or `last_due=max due`: the name before the `=` and the aggregate after
 * it, read from the step's whole text as `where` reads its expression, because `=` with blanks
 * around it is three words to the tokenizer. Undefined when there is no `<name> =`: the parser
 * reports that, and the name is all it needs for a placeholder's scope.
 */
export function readSet(text: string): SetStep | undefined {
  const match = /^([A-Za-z_][\w-]*)\s*=\s*(\S+)(?:\s+(.*\S))?\s*$/u.exec(text.trim());
  const name = match?.[1];
  const aggregate = match?.[2];
  if (name === undefined || aggregate === undefined) return undefined;
  const written = match?.[3];
  if (written === undefined) return { name, aggregate };
  const quoted = /^"([^"]*)"$/u.exec(written);
  return { name, aggregate, column: quoted?.[1] ?? written };
}

/** The canonical way to write a `set` step, which every problem with one quotes. */
const SET_FORM = "is written 'set <name> = <aggregate> <column>', as in 'set last_due = max due'";

/**
 * `set <name> = <aggregate>` (TYTO-727, ADR 0199): one value computed from the table at this
 * line, which the steps below read as `{name}`. The table passes through unchanged. `count` is
 * the number of rows; `min` and `max` compare as numbers when every non-empty cell is one, and
 * as text without case or accents otherwise; `first` and `last` read the first and last row;
 * `sum` adds numbers and refuses a cell that is not one, naming its row. A table without rows
 * gives an empty value, which the cell's note says; `count` gives 0.
 */
export function set(context: VerbContext): VerbResult {
  const table = requireTable(context);
  if (!table.ok) return table;
  const read = readSet(context.step.text);
  if (read === undefined) return argumentsProblem(context, SET_FORM);
  if (!(SET_AGGREGATES as readonly string[]).includes(read.aggregate)) {
    return argumentsProblem(
      context,
      `computes ${SET_AGGREGATES.join(', ')}, not '${read.aggregate}'`,
    );
  }
  const aggregate = read.aggregate as SetAggregate;
  const { rows } = table.value;
  const passed = { table: table.value };

  if (aggregate === 'count') {
    if (read.column !== undefined) {
      return argumentsProblem(
        context,
        `counts rows and takes no column; write 'set ${read.name} = count'`,
      );
    }
    return ok({ ...passed, values: { [read.name]: String(rows.length) } });
  }
  if (read.column === undefined) {
    return argumentsProblem(
      context,
      `'${aggregate}' reads one column, as in 'set ${read.name} = ${aggregate} due'`,
    );
  }
  // `set` reads its text by its own rule, so a column's problem points at the whole of it.
  const column = resolveColumn(
    table.value,
    read.column,
    context.written.textRange,
    context.aliases,
  );
  if (!column.ok) return column;
  const name = column.value.name;

  if (rows.length === 0) {
    return ok({
      ...passed,
      values: { [read.name]: '' },
      note: `the table has no rows, so '${read.name}' is empty`,
    });
  }
  const cells = rows.map((row) => row.values[name]);
  switch (aggregate) {
    case 'first':
      return ok({ ...passed, values: { [read.name]: cellText(cells[0]) } });
    case 'last':
      return ok({ ...passed, values: { [read.name]: cellText(cells.at(-1)) } });
    case 'sum': {
      let total = 0;
      for (const [index, cell] of cells.entries()) {
        if (comparable(cell) === '') continue;
        const value = numberOf(cell);
        if (value === undefined) {
          return err([
            diagnostic(
              'E_RECIPE_ARGUMENTS',
              {
                verb: 'set',
                problem: `adds numbers, and row ${index + 1} holds '${cellText(cell)}' in '${name}'`,
              },
              { range: context.written.textRange },
            ),
          ]);
        }
        total += value;
      }
      return ok({ ...passed, values: { [read.name]: String(total) } });
    }
    case 'min':
    case 'max': {
      const filled = cells.filter((cell) => comparable(cell) !== '');
      if (filled.length === 0) {
        return ok({
          ...passed,
          values: { [read.name]: '' },
          note: `every cell of '${name}' is empty, so '${read.name}' is empty`,
        });
      }
      return ok({ ...passed, values: { [read.name]: cellText(extreme(filled, aggregate)) } });
    }
  }
}

/** A cell as a number: a number, or text that reads as one whole. */
function numberOf(cell: CellValue | undefined): number | undefined {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : undefined;
  if (typeof cell !== 'string' || cell.trim() === '') return undefined;
  const value = Number(cell.trim());
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The least or greatest of cells that are not empty: as numbers when every one reads as a
 * number, otherwise as `sort` compares text, without case or accents. A tie keeps the first.
 */
function extreme(
  cells: readonly (CellValue | undefined)[],
  aggregate: 'min' | 'max',
): CellValue | undefined {
  const sign = aggregate === 'max' ? 1 : -1;
  const numbers = cells.map(numberOf);
  const numeric = numbers.every((value) => value !== undefined);
  let best = 0;
  for (let index = 1; index < cells.length; index += 1) {
    const order = numeric
      ? (numbers[index] as number) - (numbers[best] as number)
      : textOrder(cells[index], cells[best]);
    if (order * sign > 0) best = index;
  }
  return cells[best];
}

function textOrder(first: CellValue | undefined, second: CellValue | undefined): number {
  const left = comparable(first);
  const right = comparable(second);
  return left === right ? 0 : left < right ? -1 : 1;
}
