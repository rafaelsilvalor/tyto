import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addDays,
  calendarColumns,
  calendarOptions,
  firstWeekday,
  hiddenRows,
  inMonth,
  shiftAnchor,
  spanDays,
  weekdayOf,
} from './recipe-calendar-model.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('calendarOptions (TYTO-383)', () => {
  it('reads date=, time= and span=, a month by default, titled by the first other column', () => {
    const columns = ['due', 'title', 'at'];
    expect(calendarOptions({ date: 'due', time: 'at' }, columns)).toEqual({
      date: 'due',
      time: 'at',
      span: 'month',
      title: 'title',
    });
    const week = calendarOptions({ date: 'due', span: 'week' }, columns);
    expect(week?.span).toBe('week');
    expect(week && calendarColumns(week)).toEqual(['title', 'due']);
    expect(calendarOptions({}, columns)).toBeUndefined();
  });
});

describe('the first weekday', () => {
  it("is the locale's own: Sunday in en and pt-BR, Monday in en-GB", () => {
    expect(firstWeekday('en')).toBe(7);
    expect(firstWeekday('pt-BR')).toBe(7);
    expect(firstWeekday('en-GB')).toBe(1);
  });

  it('is Monday when the engine says nothing', () => {
    class Bare {
      constructor(readonly tag: string) {}
    }
    vi.stubGlobal('Intl', { ...Intl, Locale: Bare });
    expect(firstWeekday('en')).toBe(1);
  });
});

describe('the grid', () => {
  it('counts days as dates, across months and years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekdayOf('2026-11-08')).toBe(7);
    expect(weekdayOf('2026-11-09')).toBe(1);
  });

  it('shows the week holding the day, from the first weekday', () => {
    expect(spanDays('2026-11-08', 'week', 7)).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ]);
    const monday = spanDays('2026-11-08', 'week', 1);
    expect([monday[0], monday.at(-1)]).toEqual(['2026-11-02', '2026-11-08']);
  });

  it('shows a month as six weeks from the week holding its first day', () => {
    const sunday = spanDays('2026-11-20', 'month', 7);
    expect(sunday).toHaveLength(42);
    expect([sunday[0], sunday.at(-1)]).toEqual(['2026-11-01', '2026-12-12']);
    const monday = spanDays('2026-11-20', 'month', 1);
    expect([monday[0], monday.at(-1)]).toEqual(['2026-10-26', '2026-12-06']);
    expect(inMonth('2026-10-31', '2026-11-20')).toBe(false);
    expect(inMonth('2026-11-30', '2026-11-20')).toBe(true);
  });

  it('moves a week by seven days and a month to the next first', () => {
    expect(shiftAnchor('2026-11-08', 'week', -1)).toBe('2026-11-01');
    expect(shiftAnchor('2026-01-31', 'month', 1)).toBe('2026-02-01');
    expect(shiftAnchor('2026-01-15', 'month', -1)).toBe('2025-12-01');
  });

  it('says how many rows a day leaves out', () => {
    expect(hiddenRows(5, 3)).toBe(2);
    expect(hiddenRows(2, 3)).toBe(0);
  });
});
