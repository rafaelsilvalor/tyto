import { describe, expect, it } from 'vitest';

import {
  BOARD_PAGE,
  askedColumns,
  boardOptions,
  nextPage,
  notDrawn,
} from './recipe-board-model.js';

describe('the Board view model (TYTO-381)', () => {
  it('reads show board, a card showing the first three columns besides by= when no fields=', () => {
    const columns = ['key', 'status', 'title', 'owner', 'due'];
    expect(boardOptions({ by: 'status' }, columns)).toEqual({
      by: 'status',
      order: undefined,
      fields: ['key', 'title', 'owner'],
    });
    const chosen = boardOptions(
      { by: 'status', order: ['To Do', 'Done'], fields: ['title', 'status', 'due'] },
      columns,
    );
    expect(chosen).toEqual({ by: 'status', order: ['To Do', 'Done'], fields: ['title', 'due'] });
    expect(chosen && askedColumns(chosen)).toEqual(['status', 'title', 'due']);
    expect(boardOptions({ fields: ['title'] }, columns)).toBeUndefined();
  });

  it('asks a column fifty cards at a time, and says how many are left', () => {
    const group = { key: '"to do"', label: 'To Do', count: 120 };
    expect(nextPage(group, 0)).toEqual({ offset: 0, limit: BOARD_PAGE });
    expect(nextPage(group, 100)).toEqual({ offset: 100, limit: 20 });
    expect(nextPage(group, 120)).toBeUndefined();
    expect(notDrawn(group, 50)).toBe(70);
    expect(notDrawn(group, 120)).toBe(0);
  });
});
