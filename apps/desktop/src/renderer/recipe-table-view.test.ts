// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import type { Locale } from '../../shared/i18n/index.js';
import { OVERSCAN, PAGE_SIZE, ROW_HEIGHT } from './recipe-table-model.js';
import {
  type CopyAnswer,
  type CopyRequest,
  type RowsAnswer,
  type RowsRequest,
  tableView,
} from './recipe-table-view.js';
import { type ViewContext, fullSizeBody } from './recipe-views.js';

/**
 * The Table view in jsdom (TYTO-379, ADR 0171), against a stand-in for main that answers pages of
 * 5,000 numbered rows. **Main's stand-in orders the rows itself**, and its descending order is the
 * plain reverse, so a view that sorted a page on its own would draw a different order than the
 * one it was sent.
 */

const TOTAL = 5_000;
const RAN_AT = '2026-11-07T12:00:00.000Z';
const COLUMNS = [
  { name: 'n', type: 'number' },
  { name: 'title', type: 'text' },
  { name: 'site', type: 'link' },
];

/** Row `n` (1-based): its title, and a link that is a web address only for even rows. */
const rowOf = (n: number) => ({
  key: `R-${String(n)}`,
  values: [
    n,
    `Row ${String(n)}`,
    n % 2 === 0 ? `https://example.com/${String(n)}` : `file:///C:/${String(n)}.exe`,
  ],
});

function fakeMain(options: { readonly totals?: Record<string, number> } = {}) {
  const rows = vi.fn((request: RowsRequest): Promise<RowsAnswer> => {
    const columns = request.columns ?? COLUMNS.map((column) => column.name);
    let order = Array.from({ length: TOTAL }, (_, index) => index + 1);
    if (request.sort?.direction === 'desc') order = order.reverse();
    // The filter, as main reads it: a text in any of the columns sent.
    const needle = request.filter?.toLowerCase();
    if (needle !== undefined) {
      order = order.filter((n) =>
        columns.some((column) => {
          const value = rowOf(n).values[COLUMNS.findIndex((each) => each.name === column)];
          return String(value).toLowerCase().includes(needle);
        }),
      );
    }
    const page = order.slice(request.offset, request.offset + request.limit).map((n) => {
      const row = rowOf(n);
      return {
        key: row.key,
        values: columns.map(
          (column) => row.values[COLUMNS.findIndex((each) => each.name === column)] ?? null,
        ),
      };
    });
    return Promise.resolve({
      columns,
      rows: page,
      total: TOTAL,
      matched: order.length,
      ...(options.totals === undefined ? {} : { totals: options.totals }),
    });
  });
  const copy = vi.fn((request: CopyRequest): Promise<CopyAnswer> =>
    Promise.resolve({ rows: request.limit, columns: request.copyColumns?.length ?? 0 }),
  );
  return { rows, copy };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function render(
  more: { summary?: boolean; locale?: Locale; totals?: Record<string, number> } = {},
) {
  const main = fakeMain({ ...(more.totals === undefined ? {} : { totals: more.totals }) });
  const element = tableView({
    index: 2,
    ranAt: RAN_AT,
    columns: COLUMNS,
    total: TOTAL,
    locale: more.locale ?? 'en',
    summary: more.summary ?? false,
    rows: main.rows,
    copy: main.copy,
  });
  document.body.replaceChildren(element);
  await settle();
  return { element, ...main };
}

const firstColumn = (element: HTMLElement) =>
  [...element.querySelectorAll('.recipe-table__row')].map(
    (row) => row.querySelector('.recipe-table__cell')?.textContent,
  );
const headings = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>('.recipe-table__heading')].map((heading) => [
    heading.dataset['column'],
    heading.getAttribute('aria-sort'),
  ]);
const heading = (element: HTMLElement, name: string) =>
  element.querySelector<HTMLElement>(`.recipe-table__heading[data-column="${name}"]`);
const cellAt = (element: HTMLElement, row: number, column: number) =>
  element.querySelector<HTMLElement>(
    `.recipe-table__row[data-row="${String(row)}"] .recipe-table__cell[data-column="${String(column)}"]`,
  );
const selected = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>('.recipe-table__cell--selected')].map(
    (cell) =>
      `${cell.closest<HTMLElement>('.recipe-table__row')?.dataset['row'] ?? ''}:${cell.dataset['column'] ?? ''}`,
  );
const counter = (element: HTMLElement) =>
  element.querySelector('.recipe-table__count')?.textContent;

describe('the Table view (TYTO-379)', () => {
  it('asks main for the first page and draws only the rows in sight', async () => {
    const { element, rows } = await render();

    expect(rows.mock.calls.map(([request]) => request)).toEqual([
      { index: 2, ranAt: RAN_AT, offset: 0, limit: PAGE_SIZE, columns: ['n', 'title', 'site'] },
    ]);
    // 12 rows in sight and 8 overscan below: 20 of 5,000 exist in the document.
    expect(firstColumn(element)).toEqual(
      Array.from({ length: 20 }, (_, index) => String(index + 1)),
    );
    expect(counter(element)).toBe('Rows: 5,000');
    const canvas = element.querySelector<HTMLElement>('.recipe-table__canvas');
    expect(canvas?.style.height).toBe(`${String(TOTAL * ROW_HEIGHT)}px`);
  });

  it('draws the rows a scroll brings into sight, from the page that holds them', async () => {
    const { element, rows } = await render();
    const viewport = element.querySelector<HTMLElement>('.recipe-table__viewport');
    if (viewport === null) throw new Error('no viewport');
    // jsdom lays nothing out: the scroll position is set by hand, as a wheel would set it.
    Object.defineProperty(viewport, 'scrollTop', { value: 4_990 * ROW_HEIGHT, configurable: true });
    viewport.dispatchEvent(new Event('scroll'));
    await settle();

    expect(rows.mock.calls.map(([request]) => request.offset)).toEqual([0, 4_900]);
    expect(firstColumn(element)).toEqual(
      Array.from({ length: 18 }, (_, index) => (4_983 + index).toLocaleString('en')),
    );
    expect(element.querySelector<HTMLElement>('.recipe-table__row')?.style.top).toBe(
      `${String(4_982 * ROW_HEIGHT)}px`,
    );
  });

  it('sorts in main on a header click, and draws the page in the order main sent it', async () => {
    const { element, rows } = await render();

    heading(element, 'n')?.click();
    await settle();
    expect(rows.mock.calls.at(-1)?.[0].sort).toEqual({ column: 'n', direction: 'asc' });
    expect(headings(element)[0]).toEqual(['n', 'ascending']);

    heading(element, 'n')?.click();
    await settle();
    expect(rows.mock.calls.at(-1)?.[0].sort).toEqual({ column: 'n', direction: 'desc' });
    expect(firstColumn(element).slice(0, 3)).toEqual(['5,000', '4,999', '4,998']);
    expect(headings(element)[0]).toEqual(['n', 'descending']);

    heading(element, 'n')?.click();
    await settle();
    expect(rows.mock.calls.at(-1)?.[0].sort).toBeUndefined();
    expect(firstColumn(element).slice(0, 2)).toEqual(['1', '2']);
  });

  it('hides a column from the picker, and asks main without it', async () => {
    const { element, rows } = await render();
    const picker = element.querySelector<HTMLElement>('.recipe-table__picker');
    expect(picker?.hidden).toBe(true);
    element.querySelector<HTMLElement>('[data-action="columns"]')?.click();
    expect(picker?.hidden).toBe(false);

    const box = (name: string) =>
      element.querySelector<HTMLInputElement>(`.recipe-table__pick-box[data-column="${name}"]`);
    const title = box('title');
    if (title === null) throw new Error('no title box');
    title.checked = false;
    title.dispatchEvent(new Event('change'));
    await settle();

    expect(rows.mock.calls.at(-1)?.[0].columns).toEqual(['n', 'site']);
    expect(headings(element).map(([name]) => name)).toEqual(['n', 'site']);

    // The last shown column stays shown.
    for (const name of ['n', 'site']) {
      const each = box(name);
      if (each === null) throw new Error(`no ${name} box`);
      each.checked = false;
      each.dispatchEvent(new Event('change'));
    }
    await settle();
    expect(headings(element).map(([name]) => name)).toEqual(['site']);
    expect(box('site')?.checked).toBe(true);
  });

  it('filters in main over the shown columns only, and counts what it kept', async () => {
    const { element, rows } = await render();
    const title = element.querySelector<HTMLInputElement>(
      '.recipe-table__pick-box[data-column="title"]',
    );
    if (title === null) throw new Error('no title box');
    title.checked = false;
    title.dispatchEvent(new Event('change'));

    const search = element.querySelector<HTMLInputElement>('.recipe-table__filter');
    if (search === null) throw new Error('no filter');
    search.value = 'example.com/4998';
    search.dispatchEvent(new Event('input'));
    await settle();

    expect(rows.mock.calls.at(-1)?.[0]).toMatchObject({
      filter: 'example.com/4998',
      columns: ['n', 'site'],
      offset: 0,
    });
    expect(counter(element)).toBe('Rows: 1 of 5,000');
    expect(firstColumn(element)).toEqual(['4,998']);

    // "Row 12" is only in the hidden title: main finds nothing in the shown columns.
    search.value = 'Row 12';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(counter(element)).toBe('Rows: 0 of 5,000');
  });

  it('selects a rectangle with click and Shift-click, and copies it through main', async () => {
    const { element, copy } = await render();
    cellAt(element, 2, 0)?.click();
    cellAt(element, 4, 1)?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, shiftKey: true }),
    );

    expect(selected(element)).toEqual(['2:0', '2:1', '3:0', '3:1', '4:0', '4:1']);
    element.querySelector<HTMLElement>('[data-action="copy"]')?.click();
    await settle();

    expect(copy.mock.calls.map(([request]) => request)).toEqual([
      {
        index: 2,
        ranAt: RAN_AT,
        offset: 2,
        limit: 3,
        columns: ['n', 'title', 'site'],
        copyColumns: ['n', 'title'],
      },
    ]);
    expect(element.querySelector('.recipe-table__note')?.textContent).toBe('Rows copied: 3');
  });

  it('selects every row with Ctrl+A in the viewport, and copies them all with Ctrl+C', async () => {
    const { element, copy } = await render();
    const viewport = element.querySelector<HTMLElement>('.recipe-table__viewport');
    const all = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, cancelable: true });
    viewport?.dispatchEvent(all);

    expect(all.defaultPrevented).toBe(true);
    expect(selected(element)).toHaveLength(20 * 3);
    viewport?.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }));
    await settle();
    expect(copy.mock.calls[0]?.[0]).toMatchObject({ offset: 0, limit: TOTAL });
  });

  it('draws numbers to the right and a link as an anchor only for a web address', async () => {
    const { element } = await render();

    expect(cellAt(element, 0, 0)?.classList.contains('recipe-table__cell--number')).toBe(true);
    expect(cellAt(element, 0, 1)?.classList.contains('recipe-table__cell--number')).toBe(false);
    // Row 2 (index 1) holds https; row 1 (index 0) holds a file: path.
    expect(cellAt(element, 1, 2)?.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/2',
    );
    expect(cellAt(element, 1, 2)?.querySelector('a')?.target).toBe('_blank');
    expect(cellAt(element, 0, 2)?.querySelector('a')).toBeNull();
    expect(cellAt(element, 0, 2)?.textContent).toBe('file:///C:/1.exe');
  });

  it('drops an answer to a query that was replaced before it came', async () => {
    const main = fakeMain();
    let release: (() => void) | undefined;
    const rows = vi.fn((request: RowsRequest) =>
      request.sort === undefined
        ? new Promise<RowsAnswer>((resolve) => {
            release = () => void main.rows(request).then(resolve);
          })
        : main.rows(request),
    );
    const element = tableView({
      index: 2,
      ranAt: RAN_AT,
      columns: COLUMNS,
      total: TOTAL,
      locale: 'en',
      summary: false,
      rows,
      copy: main.copy,
    });
    document.body.replaceChildren(element);
    heading(element, 'n')?.click();
    heading(element, 'n')?.click();
    await settle();
    release?.();
    await settle();

    expect(firstColumn(element)[0]).toBe('5,000');
  });

  it('says so when the cell ran again', async () => {
    const element = tableView({
      index: 2,
      ranAt: RAN_AT,
      columns: COLUMNS,
      total: TOTAL,
      locale: 'pt-BR',
      summary: false,
      rows: () => Promise.resolve({ stale: true }),
      copy: () => Promise.resolve({ stale: true }),
    });
    await settle();

    expect(element.querySelector('.recipe-table__note')?.textContent).toBe(
      'Esta tabela rodou de novo: as linhas estão desatualizadas',
    );
  });

  it('adds the totals main sent under a Summary, in the window language', async () => {
    const { element } = await render({ summary: true, locale: 'pt-BR', totals: { n: 12_502_500 } });
    const foot = element.querySelector<HTMLElement>('.recipe-table__totals');

    expect(foot?.hidden).toBe(false);
    expect([...(foot?.children ?? [])].map((cell) => cell.textContent)).toEqual([
      '12.502.500',
      '',
      '',
    ]);
    expect(element.querySelector('.recipe-table__filter')?.getAttribute('placeholder')).toBe(
      'Filtrar linhas',
    );
  });

  it('draws no totals under a plain Table', async () => {
    const { element } = await render({ totals: { n: 1 } });
    expect(element.querySelector<HTMLElement>('.recipe-table__totals')?.hidden).toBe(true);
  });
});

describe('a cell drawn full size in a tab (TYTO-379)', () => {
  type FullCell = Parameters<typeof fullSizeBody>[0];
  const table = { columns: COLUMNS, rows: [], total: TOTAL };
  const cellOf = (more: Partial<FullCell> = {}): FullCell => ({
    index: 2,
    line: 2,
    status: 'ok',
    diagnostics: [],
    table,
    ranAt: RAN_AT,
    ...more,
  });
  const contextOf = (): ViewContext => {
    const main = fakeMain();
    const stale = () => Promise.resolve({ stale: true as const });
    return { locale: 'en', rows: main.rows, copy: main.copy, facets: stale, row: stale };
  };

  it('stretches the viewport to the tab and draws every row the tab has room for', async () => {
    const element = fullSizeBody(cellOf(), contextOf());
    if (element === undefined) throw new Error('nothing drawn');
    document.body.replaceChildren(element);
    await settle();
    const viewport = element.querySelector<HTMLElement>('.recipe-table__viewport');
    if (viewport === null) throw new Error('no viewport');

    // No fixed height: the stylesheet gives the viewport the tab's.
    expect(element.classList.contains('recipe-table--full')).toBe(true);
    expect(viewport.style.height).toBe('');
    // jsdom lays nothing out: a tab with room for 40 rows under the header, stated.
    Object.defineProperty(viewport, 'clientHeight', { value: 41 * ROW_HEIGHT });
    viewport.dispatchEvent(new Event('scroll'));
    expect(firstColumn(element)).toHaveLength(40 + OVERSCAN);
  });

  it("draws the view the cell's `show` chose, the Table under none, nothing with no kept run", () => {
    const summary = fullSizeBody(cellOf({ view: { name: 'summary', options: {} } }), contextOf());
    expect(summary?.dataset['view']).toBe('summary');
    // Under no `show` the cell keeps a preview; the tab has room for the whole table.
    expect(fullSizeBody(cellOf(), contextOf())?.dataset['view']).toBe('table');
    expect(fullSizeBody(cellOf({ ranAt: undefined }), contextOf())).toBeUndefined();
    expect(
      fullSizeBody(cellOf({ status: 'failed', table: undefined }), contextOf()),
    ).toBeUndefined();
  });
});
