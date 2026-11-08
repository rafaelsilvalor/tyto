// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import type { Locale } from '../../shared/i18n/index.js';
import type { FacetsAnswer, FacetsRequest } from './recipe-board-view.js';
import type { CalendarSpan } from './recipe-calendar-model.js';
import { calendarView } from './recipe-calendar-view.js';
import type { RowsAnswer, RowsRequest } from './recipe-table-view.js';

/**
 * The Calendar view in jsdom (TYTO-383, ADR 0177), against a stand-in for main. **Main's stand-in
 * places and counts the rows**, and its counts are larger than the rows a day is sent, so a
 * calendar that counted or placed rows itself would draw other numbers than the ones it was sent.
 */

const RAN_AT = '2026-11-08T12:00:00.000Z';
const COLUMNS = [
  { name: 'title', type: 'text' },
  { name: 'due', type: 'date' },
  { name: 'at', type: 'text' },
];

/** Rows per day as main counted them: 5 today, 1 on the 10th, others outside the week. */
const DAYS: Readonly<Record<string, number>> = {
  '2026-10-20': 1,
  '2026-11-08': 5,
  '2026-11-10': 1,
  '2026-11-20': 2,
  '?': 2,
  '': 60,
};

const dated = (key: string): boolean => key !== '' && key !== '?';

function fakeMain(today = '2026-11-08') {
  const facets = vi.fn((request: FacetsRequest): Promise<FacetsAnswer> => {
    const from = request.days?.from ?? '';
    const to = request.days?.to ?? '9999';
    const keys = Object.keys(DAYS).sort();
    const inside = keys.filter((key) => !dated(key) || (key >= from && key <= to));
    const shown = [...inside.filter(dated), ...['?', ''].filter((key) => key in DAYS)];
    const outside = (test: (key: string) => boolean) =>
      keys.filter((key) => dated(key) && test(key)).reduce((sum, key) => sum + (DAYS[key] ?? 0), 0);
    return Promise.resolve({
      facets: shown.map((key) => ({ key, label: key, count: DAYS[key] ?? 0 })),
      total: 71,
      matched: 71,
      more: 0,
      earlier: outside((key) => key < from),
      later: outside((key) => key > to),
      today,
    });
  });
  const rows = vi.fn((request: RowsRequest): Promise<RowsAnswer> => {
    const columns = request.columns ?? COLUMNS.map((column) => column.name);
    const all = (request.facet?.keys ?? []).flatMap((day) =>
      Array.from(
        { length: Math.min(DAYS[day] ?? 0, request.facet?.perDay ?? Infinity) },
        (_, n) => {
          const values: Record<string, string | null> = {
            title: `Row ${day || 'none'} ${String(n + 1)}`,
            due: day === '?' ? 'soon' : day === '' ? null : day,
            at: dated(day) ? `0${String(n + 1)}:00` : null,
          };
          return {
            key: `${day}-${String(n + 1)}`,
            values: columns.map((column) => values[column] ?? null),
            day,
            ...(dated(day) ? { time: `0${String(n + 1)}:00` } : {}),
          };
        },
      ),
    );
    return Promise.resolve({
      columns,
      rows: all.slice(request.offset, request.offset + request.limit),
      total: 71,
      matched: all.length,
    });
  });
  return { facets, rows };
}

const settle = async () => {
  for (let round = 0; round < 4; round += 1) await new Promise((done) => setTimeout(done, 0));
};

async function render(
  options: {
    span?: CalendarSpan;
    locale?: Locale;
    today?: string;
    main?: ReturnType<typeof fakeMain>;
  } = {},
) {
  const main = options.main ?? fakeMain();
  const root = calendarView({
    index: 2,
    ranAt: RAN_AT,
    columns: COLUMNS,
    total: 71,
    locale: options.locale ?? 'en',
    calendar: { date: 'due', time: 'at', span: options.span ?? 'week', title: 'title' },
    facets: main.facets,
    rows: main.rows,
    today: options.today ?? '2026-11-08',
  });
  document.body.replaceChildren(root);
  await settle();
  return { root, main };
}

const day = (root: HTMLElement, key: string) => {
  const cell = root.querySelector<HTMLElement>(`.recipe-calendar__day[data-day="${key}"]`);
  return {
    rows: [...(cell?.querySelectorAll('.recipe-calendar__row') ?? [])].map(
      (row) => row.textContent,
    ),
    more: cell?.querySelector('.recipe-calendar__more')?.textContent,
  };
};

const todayCell = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('.recipe-calendar__day--today')?.dataset['day'];

describe('the Calendar view (TYTO-383)', () => {
  it("places main's rows on their days, by time, with main's counts", async () => {
    const { root, main } = await render();

    expect(main.facets).toHaveBeenCalledWith({
      index: 2,
      ranAt: RAN_AT,
      column: 'due',
      columns: ['title', 'due', 'at'],
      bucket: 'day',
      days: { from: '2026-11-08', to: '2026-11-14' },
    });
    // One page for the week's days that hold rows, three each at most.
    expect(main.rows.mock.calls[0]?.[0]).toEqual({
      index: 2,
      ranAt: RAN_AT,
      offset: 0,
      limit: 6,
      columns: ['title', 'due', 'at'],
      facet: {
        column: 'due',
        keys: ['2026-11-08', '2026-11-10'],
        bucket: 'day',
        time: 'at',
        perDay: 3,
      },
    });
    expect(day(root, '2026-11-08')).toEqual({
      rows: ['01:00Row 2026-11-08 1', '02:00Row 2026-11-08 2', '03:00Row 2026-11-08 3'],
      more: '+2 more',
    });
    expect(day(root, '2026-11-10')).toEqual({ rows: ['01:00Row 2026-11-10 1'], more: undefined });
    expect(day(root, '2026-11-09')).toEqual({ rows: [], more: undefined });
    expect(root.querySelector('.recipe-calendar__outside')?.textContent).toBe(
      '1 earlier · 2 later',
    );
    expect(todayCell(root)).toBe('2026-11-08');
  });

  it('asks for the rest of a day when "+k more" is clicked', async () => {
    const { root, main } = await render();
    root
      .querySelector<HTMLButtonElement>('[data-day="2026-11-08"] .recipe-calendar__more')
      ?.click();
    await settle();

    expect(main.rows.mock.calls.at(-1)?.[0]).toMatchObject({
      offset: 3,
      limit: 2,
      facet: { keys: ['2026-11-08'], bucket: 'day', time: 'at' },
    });
    expect(main.rows.mock.calls.at(-1)?.[0].facet?.perDay).toBeUndefined();
    expect(day(root, '2026-11-08').rows).toHaveLength(5);
    expect(day(root, '2026-11-08').more).toBeUndefined();
  });

  it('lists the undated and the unreadable rows apart, with their count, a page at a time', async () => {
    const { root, main } = await render();
    const list = root.querySelector<HTMLElement>('.recipe-calendar__undated');

    expect(list?.querySelector('.recipe-calendar__heading')?.textContent).toBe('No date (62)');
    expect(list?.querySelectorAll('.recipe-calendar__row')).toHaveLength(50);
    // The unreadable come first, their date as written beside them.
    expect(list?.querySelector('.recipe-calendar__row')?.textContent).toBe('Row ? 1soon');
    expect(list?.querySelector('.recipe-calendar__more')?.textContent).toBe('12 more');
    expect(main.rows.mock.calls[1]?.[0]).toMatchObject({
      offset: 0,
      limit: 50,
      facet: { keys: ['?', ''], bucket: 'day' },
    });

    list?.querySelector<HTMLButtonElement>('.recipe-calendar__more')?.click();
    await settle();
    expect(main.rows.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 50, limit: 12 });
    expect(list?.querySelectorAll('.recipe-calendar__row')).toHaveLength(62);
  });

  it('draws a month of six weeks from the first weekday, in the window language', async () => {
    const { root, main } = await render({ span: 'month', locale: 'pt-BR' });

    expect(main.facets.mock.calls[0]?.[0].days).toEqual({ from: '2026-11-01', to: '2026-12-12' });
    expect(root.querySelectorAll('.recipe-calendar__day')).toHaveLength(42);
    const weekdays = [...root.querySelectorAll('.recipe-calendar__weekday')].map(
      (heading) => heading.textContent,
    );
    expect(weekdays[0]).toBe('dom.');
    expect(root.querySelector('.recipe-calendar__title')?.textContent).toBe('novembro de 2026');
    expect(
      root
        .querySelector('[data-day="2026-12-01"]')
        ?.classList.contains('recipe-calendar__day--out'),
    ).toBe(true);
    expect(day(root, '2026-11-20').rows).toHaveLength(2);
    expect(root.querySelector('.recipe-calendar__outside')?.textContent).toBe('1 antes');
  });

  it('moves a span at a time, and switches between week and month', async () => {
    const { root, main } = await render();

    root.querySelector<HTMLButtonElement>('.recipe-calendar__next')?.click();
    await settle();
    expect(main.facets.mock.calls.at(-1)?.[0].days).toEqual({
      from: '2026-11-15',
      to: '2026-11-21',
    });
    expect(day(root, '2026-11-20').rows).toHaveLength(2);

    root.querySelector<HTMLButtonElement>('[data-span="month"]')?.click();
    await settle();
    expect(main.facets.mock.calls.at(-1)?.[0].days).toEqual({
      from: '2026-11-01',
      to: '2026-12-12',
    });
    expect(root.querySelector('[data-span="month"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it("opens on the span holding main's today when this machine's is a day off", async () => {
    // The machine says Saturday the 7th; main's zone says Sunday the 8th, a week later.
    const { root, main } = await render({ today: '2026-11-07' });

    expect(main.facets.mock.calls.map(([request]) => request.days?.from)).toEqual([
      '2026-11-01',
      '2026-11-08',
    ]);
    expect(todayCell(root)).toBe('2026-11-08');
  });
});
