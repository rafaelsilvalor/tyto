import type { CellValue, Table } from '@tyto/recipe';
import { describe, expect, it } from 'vitest';

import { EMPTY_FACET, facetKey, facetsOf, rowsInFacets } from './recipe-facets.js';

const table = (statuses: readonly CellValue[]): Table => ({
  columns: [
    { name: 'key', type: 'text', origin: 'test' },
    { name: 'status', type: 'text', origin: 'test' },
  ],
  rows: statuses.map((status, index) => ({
    key: `K-${String(index + 1)}`,
    values: { key: `K-${String(index + 1)}`, status },
    provenance: { source: 'test', id: String(index), fetchedAt: '2026-11-07T12:00:00.000Z' },
  })),
});

const every = (of: Table) => of.rows.map((_, index) => index);

describe('facetsOf (TYTO-381, ADR 0177)', () => {
  it('groups values as where compares them, labelled as the first row wrote them', () => {
    const board = table(['Done', 'To Do', 'done', 'DONE ', 'Révisão', 'revisao']);
    const { facets, more } = facetsOf(board, every(board), 'status');
    expect(facets).toEqual([
      { key: '"done"', label: 'Done', count: 3 },
      { key: '"to do"', label: 'To Do', count: 1 },
      { key: '"revisao"', label: 'Révisão', count: 2 },
    ]);
    expect(more).toBe(0);
  });

  it('puts the ordered values first, the others by first appearance, and an empty value last', () => {
    const board = table(['Blocked', null, 'Done', '', 'To Do', 'In Progress', 'Done']);
    const order = ['to do', 'In progress', 'Done', 'Never used', 'To Do'];
    const { facets } = facetsOf(board, every(board), 'status', order);
    expect(facets.map((facet) => [facet.label, facet.count])).toEqual([
      ['To Do', 1],
      ['In Progress', 1],
      ['Done', 2],
      ['Blocked', 1],
      ['', 2],
    ]);
    expect(facets.at(-1)?.key).toBe(EMPTY_FACET);
  });

  it('counts only the rows the view kept, and says how many groups the limit left out', () => {
    const board = table(['a', 'b', 'c', 'a', 'd']);
    const kept = [0, 2, 3];
    expect(facetsOf(board, kept, 'status').facets).toEqual([
      { key: '"a"', label: 'a', count: 2 },
      { key: '"c"', label: 'c', count: 1 },
    ]);
    const limited = facetsOf(board, every(board), 'status', ['d'], 2);
    expect(limited.facets.map((facet) => facet.label)).toEqual(['d', 'a']);
    expect(limited.more).toBe(2);
  });
});

describe('rowsInFacets', () => {
  it('keeps the rows of the groups asked, in the order the view gave them', () => {
    const board = table(['Done', 'To Do', 'done', '', 'To Do']);
    expect(rowsInFacets(board, [4, 2, 1, 0, 3], 'status', [facetKey('done')])).toEqual([2, 0]);
    expect(rowsInFacets(board, every(board), 'status', [EMPTY_FACET, '"to do"'])).toEqual([
      1, 3, 4,
    ]);
  });
});
