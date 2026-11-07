import { describe, expect, it } from 'vitest';

import {
  OVERSCAN,
  ROW_HEIGHT,
  boundsOf,
  createPageCache,
  isSelected,
  nextSort,
  pagesOf,
  queryOf,
  select,
  selectAll,
  showValue,
  toggleHidden,
  visibleRange,
} from './recipe-table-model.js';

/** The Table view's arithmetic (TYTO-379): rows in sight, pages, sort, columns, selection. */

describe('visibleRange', () => {
  const viewport = 12 * ROW_HEIGHT;

  it('draws the rows in sight and the overscan below them at the top', () => {
    expect(visibleRange(0, viewport, 5_000)).toEqual({ start: 0, end: 12 + OVERSCAN });
  });

  it('draws the overscan on both sides in the middle', () => {
    // Row 100 is the first in sight: its top is exactly at the viewport's top.
    expect(visibleRange(100 * ROW_HEIGHT, viewport, 5_000)).toEqual({
      start: 100 - OVERSCAN,
      end: 112 + OVERSCAN,
    });
  });

  it('counts a row half in sight as in sight', () => {
    expect(visibleRange(100 * ROW_HEIGHT + 10, viewport, 5_000, ROW_HEIGHT, 0)).toEqual({
      start: 100,
      end: 113,
    });
  });

  it('reaches the last row, and never past it, at the bottom', () => {
    const bottom = 5_000 * ROW_HEIGHT - viewport;
    expect(visibleRange(bottom, viewport, 5_000)).toEqual({ start: 4_988 - OVERSCAN, end: 5_000 });
    expect(visibleRange(bottom + 10_000, viewport, 5_000).end).toBe(5_000);
  });

  it('draws nothing for an empty table and no row before the first', () => {
    expect(visibleRange(0, viewport, 0)).toEqual({ start: 0, end: 0 });
    expect(visibleRange(-50, viewport, 3)).toEqual({ start: 0, end: 3 });
  });
});

describe('pagesOf', () => {
  it('names every page a range touches, and none for an empty one', () => {
    expect(pagesOf({ start: 92, end: 128 }, 100)).toEqual([0, 1]);
    expect(pagesOf({ start: 100, end: 200 }, 100)).toEqual([1]);
    expect(pagesOf({ start: 5, end: 5 }, 100)).toEqual([]);
  });
});

describe('createPageCache', () => {
  it('drops the least recently read page past its capacity', () => {
    const cache = createPageCache<string>(2);
    cache.set(0, ['a']);
    cache.set(1, ['b']);
    cache.get(0);
    cache.set(2, ['c']);

    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(0)).toEqual(['a']);
    expect(cache.get(2)).toEqual(['c']);
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('nextSort', () => {
  it('goes ascending, descending, then back to the recipe order', () => {
    const first = nextSort(undefined, 'n');
    const second = nextSort(first, 'n');
    expect(first).toEqual({ column: 'n', direction: 'asc' });
    expect(second).toEqual({ column: 'n', direction: 'desc' });
    expect(nextSort(second, 'n')).toBeUndefined();
    expect(nextSort(second, 'title')).toEqual({ column: 'title', direction: 'asc' });
  });
});

describe('the shown columns and the query', () => {
  const all = ['key', 'title', 'points'];

  it('hides a column and shows it again, but never hides the last one', () => {
    const hidden = toggleHidden(toggleHidden(new Set(), 'key', all), 'title', all);
    expect([...hidden]).toEqual(['key', 'title']);
    expect([...toggleHidden(hidden, 'points', all)]).toEqual(['key', 'title']);
    expect([...toggleHidden(hidden, 'key', all)]).toEqual(['title']);
  });

  it('sends main only the shown columns, so the filter never matches a hidden one', () => {
    expect(
      queryOf({ sort: undefined, filter: '  done ', all, hidden: new Set(['title']) }),
    ).toEqual({ filter: 'done', columns: ['key', 'points'] });
    expect(
      queryOf({ sort: { column: 'key', direction: 'desc' }, filter: '', all, hidden: new Set() }),
    ).toEqual({ sort: { column: 'key', direction: 'desc' }, columns: all });
  });
});

describe('the selection', () => {
  it('stretches a rectangle with Shift-click from where it started, either way', () => {
    const one = select(undefined, { row: 5, column: 2 }, false);
    const stretched = select(one, { row: 1, column: 0 }, true);

    expect(boundsOf(stretched)).toEqual({ top: 1, bottom: 5, left: 0, right: 2 });
    expect(isSelected(stretched, { row: 3, column: 1 })).toBe(true);
    expect(isSelected(stretched, { row: 6, column: 1 })).toBe(false);
    expect(select(stretched, { row: 9, column: 9 }, false)).toEqual({
      anchor: { row: 9, column: 9 },
      focus: { row: 9, column: 9 },
    });
    // Shift-click with nothing selected selects the one cell.
    expect(boundsOf(select(undefined, { row: 4, column: 1 }, true))).toEqual({
      top: 4,
      bottom: 4,
      left: 1,
      right: 1,
    });
  });

  it('selects every matched row and shown column with Ctrl+A', () => {
    const all = selectAll(5_000, 3);
    expect(all === undefined ? undefined : boundsOf(all)).toEqual({
      top: 0,
      bottom: 4_999,
      left: 0,
      right: 2,
    });
    expect(selectAll(0, 3)).toBeUndefined();
  });
});

describe('showValue', () => {
  it('groups a number in the window language and right-aligns it', () => {
    expect(showValue(1234.5, 'number', 'en')).toEqual({ text: '1,234.5', numeric: true });
    expect(showValue(1234.5, 'number', 'pt-BR')).toEqual({ text: '1.234,5', numeric: true });
  });

  it('writes a date as a date in the window language, on its own day', () => {
    expect(showValue('2026-11-07', 'date', 'en').text).toBe('Nov 7, 2026');
    expect(showValue('2026-11-07', 'date', 'pt-BR').text).toBe('7 de nov. de 2026');
    expect(showValue('next week', 'date', 'en').text).toBe('next week');
  });

  it('writes a datetime with its time', () => {
    const shown = showValue('2026-11-07T15:30:00.000Z', 'datetime', 'en').text;
    expect(shown).toMatch(/^Nov [78], 2026, \d{1,2}:30\s?[AP]M$/u);
  });

  it('makes an anchor of a web link only', () => {
    expect(showValue('https://example.com/a', 'link', 'en').href).toBe('https://example.com/a');
    expect(showValue('http://example.com/', 'link', 'en').href).toBe('http://example.com/');
    for (const url of ['file:///C:/x.exe', 'javascript:alert(1)', 'ms-settings:x']) {
      expect(showValue(url, 'link', 'en'), url).toEqual({ text: url, numeric: false });
    }
    // A text column holding an address stays text.
    expect(showValue('https://example.com/', 'text', 'en').href).toBeUndefined();
  });

  it('leaves an empty value empty', () => {
    expect(showValue(null, 'number', 'en')).toEqual({ text: '', numeric: false });
  });
});
