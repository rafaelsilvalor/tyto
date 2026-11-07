import {
  type Column,
  type Table,
  cellText,
  compareCells,
  comparable,
  findColumn,
  summarize,
} from '@tyto/recipe';

/**
 * The rows a recipe's view shows, in main (TYTO-379, ADR 0171).
 *
 * The window holds a cell's first rows only (ADR 0148); a view that scrolls, sorts or filters a
 * table of thousands asks main for a page at a time. Sorting and filtering are the view's and
 * never the recipe's (ADR 0128): they order **indices into** the kept table, which is never
 * sorted in place, so the next cell and a sink still read the rows the recipe produced.
 */

export interface RowsSort {
  /** A column's canonical name, as the cell's table on the wire names it. */
  readonly column: string;
  readonly direction: 'asc' | 'desc';
}

export interface RowsQuery {
  readonly sort?: RowsSort | undefined;
  /** The quick filter: one text, matched in any of the visible columns. */
  readonly filter?: string | undefined;
  /** The columns shown, in order; all of them when absent. */
  readonly columns?: readonly string[] | undefined;
}

/** The order and totals one query gives a table: indices into its rows, never the rows moved. */
export interface RowsView {
  readonly permutation: readonly number[];
  /** By number column, its sum over the rows the filter keeps (ADR 0146: what is shown). */
  readonly totals: Readonly<Record<string, number>>;
}

/** The table's columns a query shows: those it names that exist, in its order, or every one. */
export function visibleColumns(table: Table, names: readonly string[] | undefined): Column[] {
  if (names === undefined) return [...table.columns];
  const shown: Column[] = [];
  for (const name of names) {
    const column = findColumn(table, name);
    if (column !== undefined && !shown.includes(column)) shown.push(column);
  }
  return shown;
}

/**
 * The rows the quick filter keeps, in the query's order. A row passes when any visible column
 * holds the filter's text, compared as `where` compares (no case, no accents). The sort is the
 * `sort` verb's comparator, made total by the row's place, so equal values keep the recipe's order.
 */
export function viewRows(table: Table, query: RowsQuery): RowsView {
  const columns = visibleColumns(table, query.columns);
  const needle = comparable(query.filter ?? '');
  const kept: number[] = [];
  for (let index = 0; index < table.rows.length; index += 1) {
    const row = table.rows[index];
    if (row === undefined) continue;
    if (
      needle === '' ||
      columns.some((column) => comparable(row.values[column.name]).includes(needle))
    ) {
      kept.push(index);
    }
  }
  const sorted = query.sort === undefined ? undefined : findColumn(table, query.sort.column);
  if (sorted !== undefined) {
    const sign = query.sort?.direction === 'desc' ? -1 : 1;
    kept.sort(
      (first, second) =>
        compareCells(
          table.rows[first]?.values[sorted.name],
          table.rows[second]?.values[sorted.name],
          sign,
        ) || first - second,
    );
  }
  const shown = kept.map((index) => table.rows[index]).filter((row) => row !== undefined);
  return { permutation: kept, totals: summarize({ columns: table.columns, rows: shown }).totals };
}

/**
 * One view per document, the last one asked: scrolling asks page after page of the same query,
 * and only a new query, a new run or another cell sorts again.
 */
export interface RowViews {
  view(documentId: string, index: number, ranAt: string, table: Table, query: RowsQuery): RowsView;
  forget(documentId: string): void;
}

export function createRowViews(): RowViews {
  const cached = new Map<
    string,
    { readonly table: Table; readonly key: string; readonly view: RowsView }
  >();
  return {
    view(documentId, index, ranAt, table, query) {
      const key = JSON.stringify([
        index,
        ranAt,
        query.sort ?? null,
        query.filter ?? '',
        query.columns ?? null,
      ]);
      const before = cached.get(documentId);
      if (before !== undefined && before.table === table && before.key === key) return before.view;
      const view = viewRows(table, query);
      cached.set(documentId, { table, key, view });
      return view;
    },
    forget(documentId) {
      cached.delete(documentId);
    },
  };
}

/**
 * Rows `start` to `end` of the view as tab-separated text, from the whole values and never the
 * wire's cut ones. A field holding a tab, a line break or a quote is quoted, with its quotes
 * doubled, as a spreadsheet writes it, so a pasted cell stays one cell.
 */
export function rowsAsTsv(
  table: Table,
  permutation: readonly number[],
  start: number,
  end: number,
  columns: readonly Column[],
): string {
  return permutation
    .slice(start, end)
    .map((index) =>
      columns
        .map((column) => tsvField(cellText(table.rows[index]?.values[column.name])))
        .join('\t'),
    )
    .join('\r\n');
}

function tsvField(text: string): string {
  return /[\t\r\n"]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
