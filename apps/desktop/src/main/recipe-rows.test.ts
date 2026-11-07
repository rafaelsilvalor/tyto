import type { CellValue, Table } from '@tyto/recipe';
import { describe, expect, it } from 'vitest';

import { createRowViews, rowsAsTsv, viewRows, visibleColumns } from './recipe-rows.js';

/**
 * A view's rows in main (TYTO-379, ADR 0171): indices into the kept table, sorted with the
 * `sort` verb's comparator and filtered by one quick filter over the visible columns.
 */

function table(rows: readonly Record<string, CellValue>[]): Table {
  return {
    columns: [
      { name: 'key', type: 'text', origin: 'test' },
      { name: 'title', type: 'text', origin: 'test' },
      { name: 'points', type: 'number', origin: 'test' },
    ],
    rows: rows.map((values, index) => ({
      key: `R-${String(index + 1)}`,
      values,
      provenance: { source: 'test', id: String(index), fetchedAt: '2026-11-07T00:00:00.000Z' },
    })),
  };
}

const TASKS = table([
  { key: 'R-1', title: 'Anúncio de verão', points: 3 },
  { key: 'R-2', title: 'Legenda', points: null },
  { key: 'R-3', title: 'anuncio de inverno', points: 10 },
  { key: 'R-4', title: 'Post', points: 3 },
]);

describe('viewRows', () => {
  it('sorts indices with the sort verb’s order, ties in the recipe’s order, empty last', () => {
    expect(viewRows(TASKS, { sort: { column: 'points', direction: 'asc' } }).permutation).toEqual([
      0, 3, 2, 1,
    ]);
    expect(viewRows(TASKS, { sort: { column: 'points', direction: 'desc' } }).permutation).toEqual([
      2, 0, 3, 1,
    ]);
    expect(TASKS.rows.map((row) => row.key)).toEqual(['R-1', 'R-2', 'R-3', 'R-4']);
  });

  it('filters by one text over the visible columns only, without case or accents', () => {
    expect(viewRows(TASKS, { filter: 'ANUNCIO' }).permutation).toEqual([0, 2]);
    expect(viewRows(TASKS, { filter: 'R-2' }).permutation).toEqual([1]);
    // `key` hidden: its text no longer matches.
    expect(viewRows(TASKS, { filter: 'R-2', columns: ['title', 'points'] }).permutation).toEqual(
      [],
    );
  });

  it('totals the number columns over the rows the filter keeps (ADR 0146)', () => {
    expect(viewRows(TASKS, {}).totals).toEqual({ points: 16 });
    expect(viewRows(TASKS, { filter: 'anuncio' }).totals).toEqual({ points: 13 });
  });

  it('shows the columns asked that exist, in their order, ignoring case', () => {
    expect(visibleColumns(TASKS, ['POINTS', 'missing', 'key']).map((c) => c.name)).toEqual([
      'points',
      'key',
    ]);
    expect(visibleColumns(TASKS, undefined)).toHaveLength(3);
  });
});

describe('createRowViews', () => {
  it('keeps one view per document and sorts again only for a new query or run', () => {
    const views = createRowViews();
    const first = views.view('tab-1', 0, 'ran-1', TASKS, { filter: 'a' });
    expect(views.view('tab-1', 0, 'ran-1', TASKS, { filter: 'a' })).toBe(first);
    expect(views.view('tab-1', 0, 'ran-2', TASKS, { filter: 'a' })).not.toBe(first);
    const second = views.view('tab-1', 0, 'ran-2', TASKS, { filter: 'a' });
    views.forget('tab-1');
    expect(views.view('tab-1', 0, 'ran-2', TASKS, { filter: 'a' })).not.toBe(second);
  });
});

describe('rowsAsTsv', () => {
  it('writes whole values, quoting a tab, a line break or a quote as a spreadsheet does', () => {
    const long = 'x'.repeat(5000);
    const tricky = table([
      { key: 'a\tb', title: 'say "hi"', points: 1 },
      { key: 'line\nbreak', title: long, points: null },
      { key: 'plain', title: ['one', 'two'], points: 2.5 },
    ]);
    const text = rowsAsTsv(tricky, [0, 1, 2], 0, 3, tricky.columns);
    expect(text.split('\r\n')).toEqual([
      '"a\tb"\t"say ""hi"""\t1',
      `"line\nbreak"\t${long}\t`,
      'plain\tone, two\t2.5',
    ]);
  });

  it('copies the range asked, in the view’s order', () => {
    expect(rowsAsTsv(TASKS, [2, 0, 3, 1], 1, 3, TASKS.columns.slice(0, 1))).toBe('R-1\r\nR-4');
  });
});
