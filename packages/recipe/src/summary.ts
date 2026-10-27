import type { Column, Row, Table } from './table.js';

/** What the Summary view draws: the rows as they are and one grand total per number column. */
export interface Summary {
  readonly columns: readonly Column[];
  readonly rows: readonly Row[];
  /** By column name, the sum of that number column over the rows shown. */
  readonly totals: Readonly<Record<string, number>>;
}

/**
 * The model `show summary` draws (ADR 0146): the table's rows, untouched, and a grand total for
 * each `number` column. The total is of what is shown, so after `where tasks >= 2` it adds the
 * groups left, never the ones filtered out. It is not a row, because a row would be counted by
 * the next verb and written by a sink, and not a field of the run, because the notebook draws
 * it from whichever cell it shows. An empty cell adds nothing; an empty table totals 0.
 */
export function summarize(table: Table): Summary {
  const totals: Record<string, number> = {};
  for (const column of table.columns) {
    if (column.type !== 'number') continue;
    totals[column.name] = table.rows.reduce((sum, row) => {
      const value = row.values[column.name];
      return typeof value === 'number' ? sum + value : sum;
    }, 0);
  }
  return { columns: table.columns, rows: table.rows, totals };
}
