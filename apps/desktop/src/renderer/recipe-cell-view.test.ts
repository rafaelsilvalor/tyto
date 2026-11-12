// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import type { Locale } from '../../shared/i18n/index.js';
import {
  type CellViewActions,
  type CellViewContext,
  cellOutputOf,
  relativeTime,
  tickAges,
} from './recipe-cell-view.js';
import type { FacetsAnswer, FacetsRequest } from './recipe-board-view.js';
import type { RowAnswer, RowRequest } from './recipe-cards-view.js';
import {
  type CellStatus,
  type RecipeRunAnswer,
  cellStatuses,
  createRecipeNotebook,
} from './recipe-notebook.js';
import type { RowsAnswer, RowsRequest } from './recipe-table-view.js';

/**
 * What goes under a recipe's cell (TYTO-377): its header and its table, built from a wire cell.
 * The clock is fixed, so every age below is measured against it.
 */

type Cell = RecipeRunAnswer['cells'][number];

const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const TEXT = ['recipe weekly', 'acme.pull', 'where status = done', ''].join('\n');

const tableOf = (rows: number, total = rows): NonNullable<Cell['table']> => ({
  columns: [
    { name: 'key', type: 'text' },
    { name: 'title', type: 'text' },
  ],
  rows: Array.from({ length: rows }, (_, index) => ({
    key: `T-${String(index)}`,
    values: [`T-${String(index)}`, index === 0 ? 'x'.repeat(300) : null],
  })),
  total,
});

const cellOf = (more: Partial<Cell> = {}): Cell => ({
  index: 0,
  line: 2,
  status: 'ok',
  diagnostics: [],
  table: tableOf(50, 120),
  ranAt: '2026-10-28T11:58:00.000Z',
  oldestFetchedAt: '2026-10-28T09:00:00.000Z',
  ...more,
});

const statusOf = (cell: Cell, locale: Locale = 'en', held?: 'source'): CellStatus => {
  const answer = {
    requestId: 1,
    cells: [cell],
    diagnostics: [],
    ...(held === undefined ? {} : { held }),
    ranAt: '',
  };
  const [status] = cellStatuses(TEXT, answer, locale);
  if (status === undefined) throw new Error('no status');
  return status;
};

function contextOf(more: Partial<CellViewContext> = {}) {
  const actions = {
    runFrom: vi.fn<(index: number) => void>(),
    fetchAgain: vi.fn<() => void>(),
    toggled: vi.fn<(at: number, collapsed: boolean) => void>(),
    expandedIncluded: vi.fn<(at: number, expanded: boolean) => void>(),
    apply: vi.fn<(index: number, planId: number) => void>(),
    // TYTO-379: no cell here is under `show`, so no view asks main for rows.
    rows: vi.fn(() => Promise.resolve({ stale: true as const })),
    copy: vi.fn(() => Promise.resolve({ stale: true as const })),
    facets: vi.fn(() => Promise.resolve({ stale: true as const })),
    row: vi.fn(() => Promise.resolve({ stale: true as const })),
    openTab: vi.fn<(index: number) => void>(),
  } satisfies CellViewActions;
  const context: CellViewContext = {
    locale: 'en',
    collapsed: new Set(),
    expanded: new Set(),
    applying: new Set(),
    refusals: new Map(),
    now: () => NOW,
    actions,
    ...more,
  };
  return { context, actions };
}

const render = (cell: Cell, more: Partial<CellViewContext> = {}, locale: Locale = 'en') => {
  const { context, actions } = contextOf({ locale, ...more });
  const element = cellOutputOf(statusOf(cell, locale), context).render();
  document.body.replaceChildren(element);
  return { element, actions, context };
};

const texts = (root: Element, selector: string): string[] =>
  [...root.querySelectorAll(selector)].map((node) => node.textContent ?? '');

describe("a cell's table", () => {
  it('shows 20 of the 50 rows the wire carries, and how many it leaves out', () => {
    const { element } = render(cellOf());

    expect(element.querySelector('table')).not.toBeNull();
    expect(element.querySelectorAll('tbody tr')).toHaveLength(20);
    expect(texts(element, 'th')).toEqual(['key', 'title']);
    expect(element.querySelector('th')?.getAttribute('title')).toBe('text');
    expect(element.querySelector('.recipe-cell__more')?.textContent).toBe('100 more rows');
  });

  it('says one more row in the singular, in both languages, and nothing when all are shown', () => {
    expect(render(cellOf({ table: tableOf(21) })).element.textContent).toContain('1 more row');
    expect(
      render(cellOf({ table: tableOf(21) }), {}, 'pt-BR').element.querySelector(
        '.recipe-cell__more',
      )?.textContent,
    ).toBe('mais 1 linha');
    expect(
      render(cellOf({ table: tableOf(30) }), {}, 'pt-BR').element.querySelector(
        '.recipe-cell__more',
      )?.textContent,
    ).toBe('mais 10 linhas');
    expect(render(cellOf({ table: tableOf(3) })).element.querySelector('.recipe-cell__more')).toBe(
      null,
    );
  });

  it('keeps a long value whole in its title, and an empty one empty', () => {
    const { element } = render(cellOf());
    const [, long] = element.querySelectorAll('tbody tr:first-child td');
    expect(long?.getAttribute('title')).toHaveLength(300);
    expect(element.querySelector('tbody tr:nth-child(2) td:nth-child(2)')?.textContent).toBe('');
  });

  it("shows a stale cell's kept table, and no table under a failure", () => {
    const stale = render(cellOf({ status: 'stale' }));
    expect(stale.element.querySelector('table')).not.toBeNull();
    const failed = render(cellOf({ status: 'failed', table: undefined }));
    expect(failed.element.querySelector('table')).toBeNull();
    expect(failed.element.querySelector('.recipe-cell-status')?.hasAttribute('data-failed')).toBe(
      true,
    );
  });
});

describe("a cell's view (TYTO-379)", () => {
  const plan = {
    target: 'example items',
    count: 1,
    operations: [{ write: 'mark', description: 'mark T-0' }],
    planId: 3,
    applicable: true,
  };

  it('swaps only the table for the view a `show` chose, header and plan staying', () => {
    const { element, actions } = render(cellOf({ view: { name: 'summary', options: {} }, plan }));

    expect(element.querySelector('table')).toBeNull();
    expect(element.querySelector<HTMLElement>('.recipe-table')?.dataset['view']).toBe('summary');
    // The view sits in the body a fold hides, and the header and the plan are as they were.
    expect(element.querySelector('.recipe-cell__body.recipe-table')).not.toBeNull();
    expect(texts(element, '.recipe-cell__action[data-action="run-from"]')).toEqual([
      'Run from here',
    ]);
    expect(element.querySelector('.recipe-plan')).not.toBeNull();
    expect(actions.rows.mock.calls).toEqual([
      [
        {
          index: 0,
          ranAt: '2026-10-28T11:58:00.000Z',
          offset: 0,
          limit: 100,
          columns: ['key', 'title'],
        },
      ],
    ]);
  });

  it('keeps the preview under no `show`, and asks main for nothing', () => {
    const { element, actions } = render(cellOf());

    expect(element.querySelector('table')).not.toBeNull();
    expect(element.querySelector('.recipe-table')).toBeNull();
    expect(actions.rows).not.toHaveBeenCalled();
  });

  it('builds a new element when the view changes', () => {
    const { context } = contextOf();
    const keyOf = (view?: string) =>
      cellOutputOf(
        statusOf(cellOf(view === undefined ? {} : { view: { name: view, options: {} } })),
        context,
      ).key;

    expect(new Set([keyOf(), keyOf('table'), keyOf('summary')]).size).toBe(3);
  });

  // TYTO-381: the Board reads its arguments, so another `by=` is another element.
  it('draws a board by its arguments, and builds a new element when they change', () => {
    const board = (by: string) => cellOf({ view: { name: 'board', options: { by } } });
    const { element, actions } = render(board('title'));
    const { context } = contextOf();

    expect(element.querySelector<HTMLElement>('.recipe-board')?.dataset['view']).toBe('board');
    expect(actions.facets.mock.calls).toEqual([
      [{ index: 0, ranAt: '2026-10-28T11:58:00.000Z', column: 'title', columns: ['title', 'key'] }],
    ]);
    expect(cellOutputOf(statusOf(board('title')), context).key).not.toBe(
      cellOutputOf(statusOf(board('key')), context).key,
    );
  });
});

describe("a cell's age", () => {
  it('says when it ran and how old its data is, in both languages', () => {
    const age = (locale: Locale) =>
      render(cellOf(), {}, locale).element.querySelector('.recipe-cell-age')?.textContent;
    expect(age('en')).toBe('ran 2 min. ago · data fetched 3 hr. ago');
    expect(age('pt-BR')).toBe('rodou há 2 min. · dados buscados há 3 h');
  });

  it('reads a moment ago, a minute, an hour and a day in the largest unit that fits', () => {
    const ago = (seconds: number) =>
      relativeTime(new Date(NOW - seconds * 1000).toISOString(), 'en', NOW);
    expect(ago(10)).toBe('now');
    expect(ago(-60)).toBe('now');
    expect(ago(60 * 59)).toBe('59 min. ago');
    expect(ago(60 * 60 * 5)).toBe('5 hr. ago');
    expect(ago(60 * 60 * 24)).toBe('yesterday');
  });

  it('is rewritten in place by the ticker, leaving the element and its key as they were', () => {
    const { element, context } = render(cellOf());
    const output = cellOutputOf(statusOf(cellOf()), context);

    tickAges(document, 'en', NOW + 60 * 60 * 1000);

    expect(document.body.firstElementChild).toBe(element);
    expect(element.querySelector('.recipe-cell-age')?.textContent).toBe(
      'ran 1 hr. ago · data fetched 4 hr. ago',
    );
    expect(cellOutputOf(statusOf(cellOf()), context).key).toBe(output.key);
  });

  it('is absent from a cell that never ran', () => {
    const { element } = render(
      cellOf({ status: 'stale', table: undefined, ranAt: undefined, oldestFetchedAt: undefined }),
    );
    expect(element.querySelector('.recipe-cell-age')).toBeNull();
  });
});

describe("a cell's buttons", () => {
  it('opens its own cell in a tab, and only a cell whose table main keeps (TYTO-379)', () => {
    const kept = render(cellOf({ index: 4 }));
    (kept.element.querySelector('[data-action="open-tab"]') as HTMLButtonElement).click();
    expect(kept.actions.openTab).toHaveBeenCalledWith(4);

    // A table with no run main holds pages nothing: there are no rows to draw full size.
    const unkept = render(cellOf({ ranAt: undefined }));
    expect(unkept.element.querySelector('[data-action="open-tab"]')).toBeNull();
    const failed = render(cellOf({ status: 'failed', table: undefined }));
    expect(failed.element.querySelector('[data-action="open-tab"]')).toBeNull();
  });

  it('runs from this cell, and fetches again only on a cell that fetches', () => {
    const plain = render(cellOf({ index: 3 }));
    expect(texts(plain.element, '.recipe-cell__action')).toEqual([
      'Run from here',
      'Open in a tab',
    ]);
    (plain.element.querySelector('[data-action="run-from"]') as HTMLButtonElement).click();
    expect(plain.actions.runFrom).toHaveBeenCalledWith(3);

    const source = render(cellOf({ source: true }), {}, 'pt-BR');
    expect(texts(source.element, '.recipe-cell__action')).toEqual([
      'Executar daqui',
      'Buscar de novo',
      'Abrir numa aba',
    ]);
    (source.element.querySelector('[data-action="fetch-again"]') as HTMLButtonElement).click();
    expect(source.actions.fetchAgain).toHaveBeenCalledOnce();
    expect(source.actions.runFrom).not.toHaveBeenCalled();
  });

  it('offers them on a plan, and none on a cell with neither a table nor a plan', () => {
    const plan = render(
      cellOf({
        table: undefined,
        plan: { target: 'sheet', count: 2, operations: [], applicable: false },
      }),
    );
    expect(texts(plan.element, '.recipe-cell__action')).toEqual(['Run from here']);
    const failed = render(cellOf({ status: 'failed', table: undefined, source: true }));
    expect(failed.element.querySelector('button')).toBeNull();
  });
});

describe('folding a table', () => {
  it("starts open, folds in place, and tells the host the cell's line, not its index", () => {
    // Line 3 starts at 24: an index would say 2. Outside an editor the line is the status's.
    const { element, actions } = render(cellOf({ index: 2, line: 3 }));
    const toggle = element.querySelector('.recipe-cell__toggle') as HTMLButtonElement;
    expect(element.classList.contains('recipe-cell--collapsed')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    expect(element.classList.contains('recipe-cell--collapsed')).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('Show table');
    toggle.click();
    expect(actions.toggled.mock.calls).toEqual([
      [24, true],
      [24, false],
    ]);
  });

  it('survives a rebuild: a folded cell has its own key and is built folded', () => {
    const open = contextOf();
    // Folded by its line's start, as the notebook keeps it; its index, 0, folds nothing.
    expect(
      cellOutputOf(statusOf(cellOf()), contextOf({ collapsed: new Set([0]) }).context).key,
    ).toBe(cellOutputOf(statusOf(cellOf()), open.context).key);
    const folded = contextOf({ collapsed: new Set([statusOf(cellOf()).at]) });
    const openOutput = cellOutputOf(statusOf(cellOf()), open.context);
    const foldedOutput = cellOutputOf(statusOf(cellOf()), folded.context);

    expect(foldedOutput.key).not.toBe(openOutput.key);
    const element = foldedOutput.render();
    expect(element.classList.contains('recipe-cell--collapsed')).toBe(true);
    expect(element.querySelector('.recipe-cell__toggle')?.getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('has no toggle on a cell with no table', () => {
    const { element } = render(
      cellOf({
        table: undefined,
        plan: { target: 'sheet', count: 1, operations: [], applicable: false },
      }),
    );
    expect(element.querySelector('.recipe-cell__toggle')).toBeNull();
  });
});

// TYTO-449: a `run` cell opened onto its included recipe's cells, from the answer alone.
describe("a run cell's included cells", () => {
  const included: NonNullable<Cell['included']> = [
    {
      depth: 1,
      recipe: 'tasks',
      index: 0,
      step: 'acme.pull',
      status: 'ok',
      table: tableOf(30),
      diagnostics: [],
    },
    {
      depth: 2,
      recipe: 'marks',
      index: 0,
      step: 'example.mark done',
      status: 'ok',
      plan: {
        target: 'example items',
        count: 1,
        operations: [{ write: 'mark', rowKey: 'EX-1', description: 'Mark EX-1' }],
      },
      diagnostics: [{ severity: 'warning', code: 'W_X', message: 'careful' }],
    },
  ];
  const runCell = (more: Partial<Cell> = {}) => cellOf({ included, ...more });
  const opener = (element: HTMLElement) =>
    element.querySelector('[data-action="included"]') as HTMLButtonElement;
  const nested = (element: HTMLElement) =>
    [...element.querySelectorAll('.recipe-included__cell')].map((cell) => ({
      depth: (cell as HTMLElement).dataset['depth'],
      header: cell.querySelector('.recipe-cell-status')?.textContent,
      rows: cell.querySelectorAll('tbody tr').length,
      plan: cell.querySelectorAll('.recipe-plan__operation').length,
      buttons: cell.querySelectorAll('button').length,
      problem: cell.querySelector('.recipe-included__problem')?.textContent,
    }));

  it('starts closed, opens in place from the answer, and asks main for nothing', () => {
    const { element, actions } = render(runCell({ index: 2, line: 3 }));
    expect(opener(element).textContent).toBe("Show the included recipe's cells");
    expect(opener(element).getAttribute('aria-expanded')).toBe('false');
    expect(nested(element)).toEqual([]);

    opener(element).click();
    expect(opener(element).textContent).toBe("Hide the included recipe's cells");
    expect(nested(element)).toEqual([
      {
        depth: '1',
        header: 'tasksacme.pull30 rows · 2 columns',
        rows: 20,
        plan: 0,
        buttons: 0,
        problem: undefined,
      },
      {
        depth: '2',
        header: 'marksexample.mark donePlan: 1 to write to example items',
        rows: 0,
        plan: 1,
        buttons: 0,
        problem: 'careful',
      },
    ]);
    opener(element).click();
    expect(nested(element)).toEqual([]);
    // The line, as a fold says it; and not one bridge call, nor a run.
    expect(actions.expandedIncluded.mock.calls).toEqual([
      [24, true],
      [24, false],
    ]);
    for (const call of [actions.runFrom, actions.fetchAgain, actions.apply, actions.rows]) {
      expect(call).not.toHaveBeenCalled();
    }
    expect(
      [actions.copy, actions.facets, actions.row].every((call) => call.mock.calls.length === 0),
    ).toBe(true);
  });

  it('is built open with its own key when the notebook kept it open, in both languages', () => {
    const at = statusOf(runCell()).at;
    const closed = cellOutputOf(statusOf(runCell()), contextOf().context);
    const open = cellOutputOf(statusOf(runCell()), contextOf({ expanded: new Set([at]) }).context);
    expect(open.key).not.toBe(closed.key);
    expect(nested(open.render())).toHaveLength(2);

    const { element } = render(runCell(), { expanded: new Set([at]) }, 'pt-BR');
    expect(opener(element).textContent).toBe('Ocultar as células da receita incluída');
  });

  it('offers no opener on a cell without included cells, or on a failed one', () => {
    expect(opener(render(cellOf()).element)).toBeNull();
    expect(opener(render(runCell({ status: 'failed', table: undefined })).element)).toBeNull();
  });
});

describe("a cell's key", () => {
  it('changes with the language and the run, and not with the clock', () => {
    const { context } = contextOf();
    const key = (cell: Cell, locale: Locale = 'en') =>
      cellOutputOf(statusOf(cell, locale), { ...context, locale }).key;

    expect(key(cellOf(), 'pt-BR')).not.toBe(key(cellOf()));
    expect(key(cellOf({ ranAt: '2026-10-28T11:59:00.000Z' }))).not.toBe(key(cellOf()));
    expect(cellOutputOf(statusOf(cellOf()), { ...context, now: () => NOW + 1e6 }).key).toBe(
      key(cellOf()),
    );
  });

  it('keeps the summary pull request C drew, in the header line', () => {
    const { element } = render(cellOf(), {}, 'pt-BR');
    expect(element.querySelector('.recipe-cell-status .recipe-cell-summary')?.textContent).toBe(
      '120 linhas · 2 colunas',
    );
  });
});

// TYTO-639: a view's quick filter, the Calendar's span and an opened card, kept by the
// notebook by the cell's line, so the element a new run or another language builds keeps them.
describe("a view's state across a rebuild of its cell", () => {
  const RUNS = ['2026-10-28T11:58:00.000Z', '2026-10-28T11:59:00.000Z'] as const;
  /** 120 rows, every other one titled odd: the filter `odd` keeps 60 of them. */
  const titleOf = (n: number): string => (n % 2 === 0 ? `even ${String(n)}` : `odd ${String(n)}`);
  const matching = (filter: string | undefined): number[] =>
    Array.from({ length: 120 }, (_, n) => n).filter(
      (n) => filter === undefined || titleOf(n).includes(filter),
    );

  /** Main's stand-in: it filters and counts, and answers the run it was asked about. */
  function fakeMain() {
    const rows = vi.fn((request: RowsRequest): Promise<RowsAnswer> => {
      const kept = matching(request.filter);
      const columns = request.columns ?? ['key', 'title'];
      return Promise.resolve({
        columns,
        rows: kept.slice(request.offset, request.offset + request.limit).map((n) => ({
          key: `T-${String(n)}`,
          values: columns.map((column) => (column === 'key' ? `T-${String(n)}` : titleOf(n))),
        })),
        total: 120,
        matched: kept.length,
      });
    });
    const facets = vi.fn((request: FacetsRequest): Promise<FacetsAnswer> =>
      Promise.resolve({
        facets: [{ key: 'all', label: 'all', count: matching(request.filter).length }],
        total: 120,
        matched: matching(request.filter).length,
        more: 0,
      }),
    );
    const row = vi.fn((request: RowRequest): Promise<RowAnswer> =>
      Promise.resolve({
        columns: [
          { name: 'key', type: 'text' },
          { name: 'title', type: 'text' },
        ],
        values: [request.key, `${request.key} in ${request.ranAt}`],
        provenance: { source: 'acme', id: request.key, fetchedAt: request.ranAt },
      }),
    );
    return { rows, facets, row };
  }

  /** A tab's notebook and the cell views it builds, as `main.ts` wires them. */
  function harness() {
    const notebook = createRecipeNotebook({
      run: () => new Promise(() => undefined),
      apply: () => new Promise(() => undefined),
      refusedWithoutReason: () => '',
      textOf: () => TEXT,
      show: () => undefined,
      delay: 0,
    });
    const main = fakeMain();
    // The editor's stand-in: a card opened sits over the window, outside it, as in the app.
    const editor = document.createElement('div');
    document.body.replaceChildren(editor);
    const build = (cell: Cell, locale: Locale = 'en', text = TEXT): HTMLElement => {
      const { context } = contextOf({
        locale,
        views: {
          of: (at) => notebook.viewOf('tab-1', at),
          keep: (at, state) => {
            notebook.keepView('tab-1', at, state);
          },
        },
      });
      const actions = { ...context.actions, ...main };
      const answer = { requestId: 1, cells: [cell], diagnostics: [], ranAt: '' };
      const [status] = cellStatuses(text, answer, locale);
      if (status === undefined) throw new Error('no status');
      const element = cellOutputOf(status, { ...context, actions }).render();
      editor.replaceChildren(element);
      return element;
    };
    return { notebook, main, build };
  }

  const shown = (name: string, options: Record<string, string> = {}, more: Partial<Cell> = {}) =>
    cellOf({ view: { name, options }, ...more });
  const typeFilter = (element: HTMLElement, value: string): void => {
    const search = element.querySelector<HTMLInputElement>('.recipe-table__filter');
    if (search === null) throw new Error('no filter');
    search.value = value;
    search.dispatchEvent(new Event('input'));
  };
  const filterOf = (element: HTMLElement): string | undefined =>
    element.querySelector<HTMLInputElement>('.recipe-table__filter')?.value;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** What the view last asked main, through whichever channel it reads its rows by. */
  const lastAsked = (
    calls: readonly (readonly [{ ranAt: string; filter?: string | undefined }])[],
  ) => {
    const request = calls.at(-1)?.[0];
    return { ranAt: request?.ranAt, filter: request?.filter };
  };

  const VIEWS = [
    { name: 'table', options: {}, channel: 'rows' },
    { name: 'board', options: { by: 'title' }, channel: 'facets' },
    { name: 'calendar', options: { date: 'title' }, channel: 'facets' },
    { name: 'cards', options: {}, channel: 'rows' },
  ] as const;

  for (const view of VIEWS) {
    it(`keeps the ${view.name}'s quick filter through a new run and a language change`, async () => {
      const { main, build } = harness();
      typeFilter(build(shown(view.name, view.options)), 'odd');
      await settle();

      // A new run: a new element, the filter in its box and in what it asks main.
      const rerun = build(shown(view.name, view.options, { ranAt: RUNS[1] }));
      await settle();
      expect(filterOf(rerun)).toBe('odd');
      expect(lastAsked(main[view.channel].mock.calls)).toEqual({ ranAt: RUNS[1], filter: 'odd' });
      // The count is main's for the new run, under the filter.
      expect(rerun.querySelector('.recipe-table__count')?.textContent).toBe('Rows: 60 of 120');

      const translated = build(shown(view.name, view.options, { ranAt: RUNS[1] }), 'pt-BR');
      await settle();
      expect(filterOf(translated)).toBe('odd');
      expect(lastAsked(main[view.channel].mock.calls)).toEqual({ ranAt: RUNS[1], filter: 'odd' });
      expect(translated.querySelector('.recipe-table__count')?.textContent).toBe(
        'Linhas: 60 de 120',
      );
    });
  }

  it("keeps the calendar's span through a new run and a language change", async () => {
    const { main, build } = harness();
    const calendar = (ranAt: string) => shown('calendar', { date: 'title' }, { ranAt });
    const pressed = (element: HTMLElement) =>
      element
        .querySelector('.recipe-calendar__span[aria-pressed="true"]')
        ?.getAttribute('data-span');
    const first = build(calendar(RUNS[0]));
    expect(pressed(first)).toBe('month');
    first.querySelector<HTMLElement>('.recipe-calendar__span[data-span="week"]')?.click();
    await settle();

    const rerun = build(calendar(RUNS[1]));
    await settle();
    expect(pressed(rerun)).toBe('week');
    const days = main.facets.mock.calls.at(-1)?.[0].days;
    expect(Date.parse(days?.to ?? '') - Date.parse(days?.from ?? '')).toBe(6 * 86_400_000);
    expect(pressed(build(calendar(RUNS[1]), 'pt-BR'))).toBe('week');
  });

  it('opens the loose card again from the new run, and not once it was closed', async () => {
    const { main, build } = harness();
    const first = build(shown('cards', {}, { ranAt: RUNS[0] }));
    await settle();
    first.querySelector<HTMLElement>('.recipe-cards__card[data-key="T-3"]')?.click();
    await settle();
    const dialog = () => document.querySelector<HTMLElement>('.recipe-card-dialog');
    expect(dialog()?.dataset['key']).toBe('T-3');

    build(shown('cards', {}, { ranAt: RUNS[1] }));
    await settle();
    expect(main.row.mock.calls.at(-1)?.[0]).toEqual({ index: 0, ranAt: RUNS[1], key: 'T-3' });
    expect(dialog()?.querySelector('[data-field="title"]')?.textContent).toBe(`T-3 in ${RUNS[1]}`);

    dialog()?.querySelector<HTMLElement>('.recipe-card-dialog__close')?.click();
    const asked = main.row.mock.calls.length;
    build(shown('cards', {}, { ranAt: RUNS[0] }));
    await settle();
    expect(dialog()).toBeNull();
    expect(main.row.mock.calls).toHaveLength(asked);
  });

  it('follows its line when a step is inserted above, and never lands on another cell', async () => {
    const { notebook, main, build } = harness();
    typeFilter(build(shown('table')), 'odd');
    await settle();

    // `acme.x` typed at the very start of line 2, so above it: the cell moves down a line and
    // an index on, and the new step takes its old line and index.
    const inserted = 'acme.x\n';
    const from = TEXT.indexOf('acme.pull');
    notebook.edited('tab-1', (at) => (at >= from ? at + inserted.length : at));
    const text = TEXT.slice(0, from) + inserted + TEXT.slice(from);

    const moved = build(shown('table', {}, { index: 1, line: 3, ranAt: RUNS[1] }), 'en', text);
    await settle();
    expect(filterOf(moved)).toBe('odd');
    expect(main.rows.mock.calls.at(-1)?.[0]).toMatchObject({ index: 1, filter: 'odd' });

    const newcomer = build(shown('table', {}, { index: 0, line: 2, ranAt: RUNS[1] }), 'en', text);
    await settle();
    expect(filterOf(newcomer)).toBe('');
    expect(main.rows.mock.calls.at(-1)?.[0].filter).toBeUndefined();
  });
});
