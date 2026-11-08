import type { CellValue, Table } from '@tyto/recipe';
import { describe, expect, it } from 'vitest';

import { zoneClock } from './recipe-clock.js';
import {
  EMPTY_FACET,
  NO_DATE,
  UNREADABLE_DATE,
  dayFacetsOf,
  dayStamp,
  facetKey,
  facetsOf,
  rowsInDays,
  rowsInFacets,
  timeOfDay,
  todayIn,
} from './recipe-facets.js';

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

// TYTO-383, the Calendar: days are read in the run's zone (ADR 0148 decision 7).
const SAO_PAULO = zoneClock('America/Sao_Paulo', () => new Date('2026-11-09T02:30:00.000Z'));
const UTC = zoneClock('UTC', () => new Date('2026-11-09T02:30:00.000Z'));

const dated = (dates: readonly CellValue[], times: readonly CellValue[] = []): Table => ({
  columns: [
    { name: 'key', type: 'text', origin: 'test' },
    { name: 'due', type: 'datetime', origin: 'test' },
    { name: 'at', type: 'text', origin: 'test' },
  ],
  rows: dates.map((due, index) => ({
    key: `D-${String(index + 1)}`,
    values: { key: `D-${String(index + 1)}`, due, at: times[index] ?? null },
    provenance: { source: 'test', id: String(index), fetchedAt: '2026-11-07T12:00:00.000Z' },
  })),
});

describe('dayStamp (TYTO-383)', () => {
  it('reads a time with an offset on the zone wall, across midnight, and a date as written', () => {
    expect(dayStamp('2026-11-09T01:30:00Z', SAO_PAULO)).toEqual({
      day: '2026-11-08',
      minutes: 22 * 60 + 30,
    });
    expect(dayStamp('2026-11-09T01:30:00Z', UTC)).toEqual({ day: '2026-11-09', minutes: 90 });
    expect(dayStamp('2026-11-09T01:30-03:00', UTC)).toEqual({ day: '2026-11-09', minutes: 270 });
    // A date, or a time without an offset, is already wall-clock: no zone moves it.
    expect(dayStamp('2026-11-09', SAO_PAULO)).toEqual({ day: '2026-11-09' });
    expect(dayStamp('2026-11-09 08:15', SAO_PAULO)).toEqual({ day: '2026-11-09', minutes: 495 });
  });

  it('keeps an empty value apart from one that names no day', () => {
    for (const value of [null, undefined, '', '  ']) {
      expect(dayStamp(value, UTC).day).toBe(NO_DATE);
    }
    for (const value of ['soon', '2026-02-30', '2026-11-09T25:00', 12, true, ['2026-11-09']]) {
      expect(dayStamp(value, UTC).day).toBe(UNREADABLE_DATE);
    }
  });

  it('reads a time column as HH:MM or as a written time on the zone wall', () => {
    expect(timeOfDay('9:05', UTC)).toBe(545);
    expect(timeOfDay('2026-11-09T01:30:00Z', SAO_PAULO)).toBe(22 * 60 + 30);
    expect(timeOfDay('24:00', UTC)).toBeUndefined();
    expect(timeOfDay('noon', UTC)).toBeUndefined();
    expect(todayIn(SAO_PAULO)).toBe('2026-11-08');
    expect(todayIn(UTC)).toBe('2026-11-09');
  });
});

describe('dayFacetsOf', () => {
  it('counts days in date order, then the unreadable and the undated, never dropping them', () => {
    const rows = dated(['2026-11-10', null, 'soon', '2026-11-09T01:30:00Z', '2026-11-10', '']);
    const { facets, more, earlier, later } = dayFacetsOf(rows, every(rows), 'due', SAO_PAULO);
    expect(facets).toEqual([
      { key: '2026-11-08', label: '2026-11-08', count: 1 },
      { key: '2026-11-10', label: '2026-11-10', count: 2 },
      { key: UNREADABLE_DATE, label: UNREADABLE_DATE, count: 1 },
      { key: NO_DATE, label: NO_DATE, count: 2 },
    ]);
    expect([more, earlier, later]).toEqual([0, 0, 0]);
  });

  it('keeps only the days asked, and counts the dated rows before and after them', () => {
    const rows = dated(['2026-11-01', '2026-11-03', '2026-11-05', '2026-11-30', null, 'x']);
    const counted = dayFacetsOf(rows, every(rows), 'due', UTC, {
      from: '2026-11-02',
      to: '2026-11-08',
    });
    expect(counted.facets.map((facet) => [facet.key, facet.count])).toEqual([
      ['2026-11-03', 1],
      ['2026-11-05', 1],
      [UNREADABLE_DATE, 1],
      [NO_DATE, 1],
    ]);
    expect([counted.earlier, counted.later]).toEqual([1, 1]);
  });
});

describe('rowsInDays', () => {
  it('orders the days asked by day then time, the untimed last, and keeps a day its first rows', () => {
    const rows = dated(
      ['2026-11-10', '2026-11-09', '2026-11-10', '2026-11-10', '2026-11-10', '2026-11-11'],
      ['14:00', null, '08:30', null, '09:00', '07:00'],
    );
    const keys = ['2026-11-09', '2026-11-10'];
    const found = rowsInDays(rows, every(rows), 'due', keys, UTC, { time: 'at' });
    expect(found).toEqual([
      { index: 1, day: '2026-11-09' },
      { index: 2, day: '2026-11-10', minutes: 510 },
      { index: 4, day: '2026-11-10', minutes: 540 },
      { index: 0, day: '2026-11-10', minutes: 840 },
      { index: 3, day: '2026-11-10' },
    ]);
    const first = rowsInDays(rows, every(rows), 'due', keys, UTC, { time: 'at', perDay: 2 });
    expect(first.map((row) => row.index)).toEqual([1, 2, 4]);
  });

  it('reads a datetime date in the zone, and pages the undated groups too', () => {
    const rows = dated(['2026-11-09T01:30:00Z', null, 'later']);
    expect(rowsInDays(rows, every(rows), 'due', ['2026-11-08'], SAO_PAULO)).toEqual([
      { index: 0, day: '2026-11-08', minutes: 1350 },
    ]);
    expect(rowsInDays(rows, every(rows), 'due', ['2026-11-08'], UTC)).toEqual([]);
    expect(
      rowsInDays(rows, every(rows), 'due', [UNREADABLE_DATE, NO_DATE], UTC).map((row) => row.day),
    ).toEqual([UNREADABLE_DATE, NO_DATE]);
  });
});
