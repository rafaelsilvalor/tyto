import { describe, expect, it } from 'vitest';

import {
  HISTORY_LIMIT,
  HistoryCursor,
  type HistoryStorage,
  loadHistory,
  saveHistory,
  searchHistory,
  withHistoryLine,
} from './command-history.js';

/** The command panel's history (TYTO-496): ↑/↓, Ctrl+R, and one list per folder. */

const memoryStorage = (): HistoryStorage & { readonly items: Map<string, string> } => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
};

describe('adding a line', () => {
  it('moves a line run again to the end instead of keeping it twice', () => {
    expect(withHistoryLine(['a', 'b', 'c'], ' a ')).toEqual(['b', 'c', 'a']);
    expect(withHistoryLine(['a'], '   ')).toEqual(['a']);
  });

  it('keeps the newest lines up to the limit', () => {
    const full = Array.from({ length: HISTORY_LIMIT }, (_, index) => `line ${String(index)}`);
    const next = withHistoryLine(full, 'newest');
    expect(next).toHaveLength(HISTORY_LIMIT);
    expect(next[0]).toBe('line 1');
    expect(next.at(-1)).toBe('newest');
  });
});

describe('walking it with the arrows', () => {
  it('goes back from the newest and gives the typed line back past the end', () => {
    const cursor = new HistoryCursor(['render a', 'check b']);
    expect(cursor.older('half typ')).toBe('check b');
    expect(cursor.older('check b')).toBe('render a');
    expect(cursor.older('render a')).toBeUndefined();
    expect(cursor.newer()).toBe('check b');
    expect(cursor.newer()).toBe('half typ');
    expect(cursor.newer()).toBeUndefined();
  });
});

describe('searching it with Ctrl+R', () => {
  const history = ['render a.brief', 'check b.brief', 'render c.brief', 'trust add .'];

  it('finds the newest match, ignoring case, and an older one from there', () => {
    const first = searchHistory(history, 'RENDER');
    expect(first).toEqual({ line: 'render c.brief', index: 2 });
    expect(searchHistory(history, 'render', first?.index)).toEqual({
      line: 'render a.brief',
      index: 0,
    });
    expect(searchHistory(history, 'render', 0)).toBeUndefined();
    expect(searchHistory(history, 'watch')).toBeUndefined();
  });
});

describe('keeping it per folder', () => {
  it('reads back what was written for the same folder, and nothing for another', () => {
    const storage = memoryStorage();
    saveHistory(storage, 'C:\\work\\campanha', ['render a.brief']);
    saveHistory(storage, null, ['plugin list']);
    expect(loadHistory(storage, 'C:\\work\\campanha')).toEqual(['render a.brief']);
    expect(loadHistory(storage, null)).toEqual(['plugin list']);
    expect(loadHistory(storage, 'C:\\work\\outra')).toEqual([]);
  });

  it('treats a storage that throws or holds nonsense as an empty history', () => {
    const throwing: HistoryStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(loadHistory(throwing, null)).toEqual([]);
    expect(() => {
      saveHistory(throwing, null, ['a']);
    }).not.toThrow();
    const storage = memoryStorage();
    storage.items.set('tyto.commandPanel.history:', '{"not":"a list"}');
    expect(loadHistory(storage, null)).toEqual([]);
    storage.items.set('tyto.commandPanel.history:', '[1, "kept", null]');
    expect(loadHistory(storage, null)).toEqual(['kept']);
  });
});
