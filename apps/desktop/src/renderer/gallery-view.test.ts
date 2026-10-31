import { describe, expect, it } from 'vitest';

import type { GalleryEntryView } from '../../shared/ipc.js';
import { cardAction, filterCounts, matchesFilter } from './gallery-view.js';

function entry(overrides: Partial<GalleryEntryView>): GalleryEntryView {
  return {
    id: 'tabela',
    kind: 'template',
    name: 'Tabela',
    description: 'A table.',
    latest: 'v2',
    configurations: [],
    state: 'not installed',
    compatible: true,
    engine: '>=0.1.0',
    pinned: [],
    files: [],
    synced: true,
    ...overrides,
  };
}

describe('cardAction', () => {
  it('offers Install, nothing, or Update to the latest tag, by state', () => {
    expect(cardAction(entry({}))).toEqual({ kind: 'install' });
    expect(cardAction(entry({ state: 'installed', pinned: ['v2'] }))).toEqual({
      kind: 'installed',
    });
    expect(cardAction(entry({ state: 'update available', pinned: ['v1'] }))).toEqual({
      kind: 'update',
      from: ['v1'],
      to: 'v2',
    });
  });

  it('offers no action on an entry this Tyto cannot load, whatever its state', () => {
    for (const state of ['not installed', 'update available'] as const) {
      expect(cardAction(entry({ state, compatible: false, engine: '>=9.0.0' }))).toEqual({
        kind: 'incompatible',
        engine: '>=9.0.0',
      });
    }
  });
});

describe('the filters', () => {
  const entries = [
    entry({ id: 'a' }),
    entry({ id: 'b', kind: 'plugin', state: 'installed' }),
    entry({ id: 'c', state: 'update available' }),
  ];

  it('split by kind, and count an entry with an update as installed', () => {
    const shown = (filter: Parameters<typeof matchesFilter>[1]) =>
      entries.filter((candidate) => matchesFilter(candidate, filter)).map(({ id }) => id);
    expect(shown('all')).toEqual(['a', 'b', 'c']);
    expect(shown('templates')).toEqual(['a', 'c']);
    expect(shown('plugins')).toEqual(['b']);
    expect(shown('installed')).toEqual(['b', 'c']);
    expect(shown('updates')).toEqual(['c']);
  });

  it('count what each one shows', () => {
    expect(filterCounts(entries)).toEqual({
      all: 3,
      templates: 2,
      plugins: 1,
      installed: 2,
      updates: 1,
    });
  });
});
