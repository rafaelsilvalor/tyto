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
import { type CellStatus, type RecipeRunAnswer, cellStatuses } from './recipe-notebook.js';

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
    toggled: vi.fn<(index: number, collapsed: boolean) => void>(),
  } satisfies CellViewActions;
  const context: CellViewContext = {
    locale: 'en',
    collapsed: new Set(),
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
  it('runs from this cell, and fetches again only on a cell that fetches', () => {
    const plain = render(cellOf({ index: 3 }));
    expect(texts(plain.element, '.recipe-cell__action')).toEqual(['Run from here']);
    (plain.element.querySelector('[data-action="run-from"]') as HTMLButtonElement).click();
    expect(plain.actions.runFrom).toHaveBeenCalledWith(3);

    const source = render(cellOf({ source: true }), {}, 'pt-BR');
    expect(texts(source.element, '.recipe-cell__action')).toEqual([
      'Executar daqui',
      'Buscar de novo',
    ]);
    (source.element.querySelector('[data-action="fetch-again"]') as HTMLButtonElement).click();
    expect(source.actions.fetchAgain).toHaveBeenCalledOnce();
    expect(source.actions.runFrom).not.toHaveBeenCalled();
  });

  it('offers them on a plan, and none on a cell with neither a table nor a plan', () => {
    const plan = render(cellOf({ table: undefined, plan: { target: 'sheet', count: 2 } }));
    expect(texts(plan.element, '.recipe-cell__action')).toEqual(['Run from here']);
    const failed = render(cellOf({ status: 'failed', table: undefined, source: true }));
    expect(failed.element.querySelector('button')).toBeNull();
  });
});

describe('folding a table', () => {
  it('starts open, folds in place, and tells the host which cell', () => {
    const { element, actions } = render(cellOf({ index: 2 }));
    const toggle = element.querySelector('.recipe-cell__toggle') as HTMLButtonElement;
    expect(element.classList.contains('recipe-cell--collapsed')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    expect(element.classList.contains('recipe-cell--collapsed')).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('Show table');
    toggle.click();
    expect(actions.toggled.mock.calls).toEqual([
      [2, true],
      [2, false],
    ]);
  });

  it('survives a rebuild: a folded cell has its own key and is built folded', () => {
    const open = contextOf();
    const folded = contextOf({ collapsed: new Set([0]) });
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
    const { element } = render(cellOf({ table: undefined, plan: { target: 'sheet', count: 1 } }));
    expect(element.querySelector('.recipe-cell__toggle')).toBeNull();
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
