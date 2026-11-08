// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import type { Locale } from '../../shared/i18n/index.js';
import { type CellViewActions, type CellViewContext, cellOutputOf } from './recipe-cell-view.js';
import { type CellStatus, type RecipeRunAnswer, cellStatuses } from './recipe-notebook.js';
import { summaryOf } from './recipe-plan-view.js';

/**
 * What goes under a plan cell (TYTO-378): its lines, Apply, and the marks after it, built from a
 * wire cell through the same `cellOutputOf` the window calls.
 */

type Cell = RecipeRunAnswer['cells'][number];
type Plan = NonNullable<Cell['plan']>;
type Applied = NonNullable<Cell['applied']>;

const TEXT = ['recipe marks', 'example.pull count=60', 'example.mark done', ''].join('\n');

const operations = (count: number): Plan['operations'] =>
  Array.from({ length: count }, (_, index) => ({
    write: 'mark',
    rowKey: `EX-${String(index + 1)}`,
    description: `Mark EX-${String(index + 1)} as 'done'`,
  }));

const planOf = (more: Partial<Plan> = {}): Plan => ({
  target: 'example items',
  count: 60,
  operations: operations(50),
  planId: 4,
  applicable: true,
  ...more,
});

const cellOf = (more: Partial<Cell> = {}): Cell => ({
  index: 1,
  line: 3,
  status: 'ok',
  plan: planOf(),
  diagnostics: [],
  ranAt: '2026-11-07T11:58:00.000Z',
  ...more,
});

const appliedOf = (statuses: Applied['operations']): Applied => ({
  at: '2026-11-07T12:00:00.000Z',
  applied: statuses.filter((each) => each.status === 'applied').length,
  failed: statuses.filter((each) => each.status === 'failed').length,
  skipped: statuses.filter((each) => each.status === 'skipped').length,
  operations: statuses,
});

const statusOf = (cell: Cell, locale: Locale, held?: 'apply'): CellStatus => {
  const answer = { cells: [cell], ...(held === undefined ? {} : { held }) };
  const [status] = cellStatuses(TEXT, answer, locale);
  if (status === undefined) throw new Error('no status');
  return status;
};

function render(
  cell: Cell,
  more: Partial<CellViewContext> = {},
  options: { locale?: Locale; held?: 'apply' } = {},
) {
  const locale = options.locale ?? 'en';
  const actions = {
    runFrom: vi.fn<(index: number) => void>(),
    fetchAgain: vi.fn<() => void>(),
    toggled: vi.fn<(index: number, collapsed: boolean) => void>(),
    apply: vi.fn<(index: number, planId: number) => void>(),
    // TYTO-379: no cell here is under `show`, so no view asks main for rows.
    rows: vi.fn(() => Promise.resolve({ stale: true as const })),
    copy: vi.fn(() => Promise.resolve({ stale: true as const })),
    facets: vi.fn(() => Promise.resolve({ stale: true as const })),
    row: vi.fn(() => Promise.resolve({ stale: true as const })),
  } satisfies CellViewActions;
  const context: CellViewContext = {
    locale,
    collapsed: new Set(),
    applying: new Set(),
    refusals: new Map(),
    now: () => Date.parse('2026-11-07T12:00:00.000Z'),
    actions,
    ...more,
  };
  const output = cellOutputOf(statusOf(cell, locale, options.held), context);
  const element = output.render();
  document.body.replaceChildren(element);
  return { element, actions, key: output.key };
}

const texts = (root: Element, selector: string): string[] =>
  [...root.querySelectorAll(selector)].map((node) => node.textContent ?? '');

const applyIn = (root: Element) => root.querySelector<HTMLButtonElement>('[data-action="apply"]');

describe("a plan cell's lines", () => {
  it('shows 20 of the 50 lines the wire carries, and how many of the plan it leaves out', () => {
    const { element } = render(cellOf());

    expect(texts(element, '.recipe-cell-summary')).toEqual(['Plan: 60 to write to example items']);
    expect(element.querySelectorAll('.recipe-plan__operation')).toHaveLength(20);
    expect(texts(element, '.recipe-plan__operation').at(0)).toBe("markEX-1Mark EX-1 as 'done'");
    expect(texts(element, '.recipe-plan__more')).toEqual(['40 more operations']);
  });

  it('heads the lines with the count and target when the header counts a table instead', () => {
    const table = { columns: [{ name: 'title', type: 'text' }], rows: [], total: 60 };
    const { element } = render(cellOf({ table }));

    expect(texts(element, '.recipe-cell-summary')).toEqual(['60 rows · 1 column']);
    expect(texts(element, '.recipe-plan__heading')).toEqual(['Plan: 60 to write to example items']);
    expect(render(cellOf()).element.querySelector('.recipe-plan__heading')).toBeNull();
  });

  it('says one more operation in the singular, in both languages, and nothing when all show', () => {
    const one = planOf({ count: 21, operations: operations(21) });
    expect(texts(render(cellOf({ plan: one })).element, '.recipe-plan__more')).toEqual([
      '1 more operation',
    ]);
    const element = render(cellOf({ plan: one }), {}, { locale: 'pt-BR' }).element;
    expect(texts(element, '.recipe-plan__more')).toEqual(['mais 1 operação']);
    const all = planOf({ count: 3, operations: operations(3) });
    expect(render(cellOf({ plan: all })).element.querySelector('.recipe-plan__more')).toBeNull();
  });
});

describe('Apply', () => {
  it('is offered on a plan that may be applied, and names the cell and the plan', () => {
    const { element, actions } = render(cellOf());

    expect(texts(element, '.recipe-cell__action')).toEqual(['Apply', 'Run from here']);
    applyIn(element)?.click();
    expect(actions.apply.mock.calls).toEqual([[1, 4]]);
  });

  it('is not offered on a plan that may not be applied, nor on one applied already', () => {
    const closed = render(cellOf({ plan: planOf({ applicable: false }) }));
    expect(applyIn(closed.element)).toBeNull();
    const unstamped = render(cellOf({ plan: planOf({ planId: undefined }) }));
    expect(applyIn(unstamped.element)).toBeNull();
    const done = render(
      cellOf({ applied: appliedOf([{ status: 'applied' }]), plan: planOf({ applicable: true }) }),
    );
    expect(applyIn(done.element)).toBeNull();
  });

  it('stays, aria-disabled, while its Apply is on its way, and a click asks nothing', () => {
    const { element, actions, key } = render(cellOf(), { applying: new Set([1]) });

    expect(applyIn(element)?.getAttribute('aria-disabled')).toBe('true');
    applyIn(element)?.click();
    expect(actions.apply).not.toHaveBeenCalled();
    expect(key).not.toBe(render(cellOf()).key);
  });

  it('is aria-disabled from the click on, so a second click asks nothing', () => {
    const { element, actions } = render(cellOf());
    expect(applyIn(element)?.hasAttribute('aria-disabled')).toBe(false);

    applyIn(element)?.click();
    applyIn(element)?.click();
    expect(applyIn(element)?.getAttribute('aria-disabled')).toBe('true');
    expect(actions.apply).toHaveBeenCalledOnce();
  });
});

describe('after Apply', () => {
  const outcome = appliedOf([
    { status: 'applied' },
    { status: 'failed', reason: "EX-2 is marked 'done' now, not 'null' as planned" },
    { status: 'applied' },
  ]);
  const applied = cellOf({
    plan: planOf({ count: 3, operations: operations(3), applicable: false }),
    applied: outcome,
  });

  it('marks each line with its outcome and reason, and counts them', () => {
    const { element } = render(applied);

    expect(
      [...element.querySelectorAll<HTMLElement>('.recipe-plan__operation')].map((line) => [
        line.dataset['status'],
        line.querySelector('.recipe-plan__mark')?.textContent,
        line.querySelector('.recipe-plan__reason')?.textContent,
      ]),
    ).toEqual([
      ['applied', 'applied', undefined],
      ['failed', 'failed', "EX-2 is marked 'done' now, not 'null' as planned"],
      ['applied', 'applied', undefined],
    ]);
    expect(texts(element, '.recipe-plan__summary')).toEqual(['2 applied · 1 failed']);
  });

  it('says the marks and the summary in Portuguese, and a cell key that changes once applied', () => {
    const { element, key } = render(applied, {}, { locale: 'pt-BR' });

    expect(texts(element, '.recipe-plan__mark')).toEqual(['aplicada', 'falhou', 'aplicada']);
    expect(texts(element, '.recipe-plan__summary')).toEqual(['2 aplicadas · 1 falharam']);
    expect(render(cellOf(), {}, { locale: 'pt-BR' }).key).not.toBe(key);
  });

  it("counts from main's totals, past the lines the wire carries, and says when none applied", () => {
    expect(summaryOf({ ...outcome, applied: 70, skipped: 3 }, 'en')).toBe(
      '70 applied · 1 failed · 3 skipped',
    );
    expect(summaryOf(appliedOf([]), 'en')).toBe('Nothing was applied');
  });
});

describe('what a plan cell says besides its lines', () => {
  it('shows a refusal on the cell, as an alert, with the key changed', () => {
    const refusal = "Applying the plan of 'example.mark' was refused: it was applied already.";
    const { element, key } = render(cellOf(), { refusals: new Map([[1, refusal]]) });

    expect(texts(element, '.recipe-plan__refusal')).toEqual([refusal]);
    expect(element.querySelector('.recipe-plan__refusal')?.getAttribute('role')).toBe('alert');
    expect(key).not.toBe(render(cellOf()).key);
  });

  it('says apply auto waits in a folder not trusted, and nothing of it otherwise', () => {
    const held = render(cellOf(), {}, { held: 'apply' }).element;
    expect(texts(held, '.recipe-plan__held')).toEqual([
      'apply auto waits: this folder is not trusted, so Apply asks for a click',
    ]);
    expect(render(cellOf()).element.querySelector('.recipe-plan__held')).toBeNull();
  });
});
