// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { type CellViewActions, cellOutputOf } from './recipe-cell-view.js';
import {
  type RecipeApplyTogetherAnswer,
  type RecipeRunAnswer,
  cellStatuses,
  createRecipeNotebook,
} from './recipe-notebook.js';
import { togetherOutputOf } from './recipe-together-view.js';

/**
 * Apply all (TYTO-758, ADR 0219): one Apply under the `apply together` header line, none per
 * plan, and the notebook that asks `recipe:apply-together` once and shows main's cells.
 */

type Cell = RecipeRunAnswer['cells'][number];

const TEXT = [
  'recipe ship',
  'apply together',
  'deliveries',
  'rename-exports stem=stem',
  'demo.send',
  '',
].join('\n');

const planCell = (index: number, planId: number, applied = false): Cell => ({
  index,
  line: index + 3,
  status: 'ok',
  plan: {
    target: 'files',
    count: 1,
    operations: [{ write: 'rename', rowKey: 'MCA-1', description: `step ${String(index)}` }],
    planId,
    applicable: !applied,
  },
  ...(applied
    ? {
        applied: {
          at: '2026-11-19T12:00:00.000Z',
          applied: 1,
          failed: 0,
          skipped: 0,
          operations: [{ status: 'applied' as const }],
        },
      }
    : {}),
  diagnostics: [],
  ranAt: '2026-11-19T11:58:00.000Z',
});

const ANSWER: RecipeRunAnswer = {
  requestId: 1,
  cells: [
    { index: 0, line: 3, status: 'ok', diagnostics: [], ranAt: '2026-11-19T11:58:00.000Z' },
    planCell(1, 7),
    planCell(2, 8),
  ],
  diagnostics: [],
  ranAt: '2026-11-19T11:58:00.000Z',
  together: true,
};

const context = (more: Partial<Parameters<typeof togetherOutputOf>[2]> = {}) => ({
  locale: 'en' as const,
  state: { applying: false, said: undefined },
  progress: new Map(),
  apply: vi.fn<() => void>(),
  cancel: vi.fn<() => void>(),
  ...more,
});

describe('Apply all under apply together', () => {
  it('sits under the header line, and asks once on a click', () => {
    const shown = context();
    const output = togetherOutputOf(TEXT, ANSWER, shown);

    expect(output?.at).toBe(TEXT.indexOf('apply together'));
    const element = output?.render();
    const button = element?.querySelector<HTMLButtonElement>('[data-action="apply-together"]');
    expect(button?.textContent).toBe('Apply all plans');
    button?.click();
    button?.click();
    expect(shown.apply).toHaveBeenCalledTimes(1);
  });

  it('says itself in Portuguese too', () => {
    const element = togetherOutputOf(TEXT, ANSWER, context({ locale: 'pt-BR' }))?.render();
    expect(element?.querySelector('[data-action="apply-together"]')?.textContent).toBe(
      'Aplicar todos os planos',
    );
    expect(element?.querySelector('.recipe-together__hint')?.textContent).toBe(
      'Aplica cada plano abaixo, em ordem, e para no primeiro que não passar.',
    );
    const english = togetherOutputOf(TEXT, ANSWER, context())?.render();
    expect(english?.querySelector('.recipe-together__hint')?.textContent).toBe(
      'Applies every plan below in order, and stops at the first one that does not go through.',
    );
  });

  it('is not drawn for a recipe without the header, and offers no button once nothing is left', () => {
    const plain = { ...ANSWER, together: undefined };
    expect(togetherOutputOf(TEXT, plain, context())).toBeUndefined();
    const done = { ...ANSWER, cells: [planCell(1, 7, true), planCell(2, 8, true)] };
    const element = togetherOutputOf(TEXT, done, context())?.render();
    expect(element?.querySelector('[data-action="apply-together"]')).toBeNull();
  });

  it('shows the progress of the cell being applied with Cancel, and where main stopped', () => {
    const shown = context({
      state: { applying: true, said: undefined },
      progress: new Map([[2, { done: 0, total: 1, note: 'sent 48 of 100 MB', cancelling: false }]]),
    });
    const element = togetherOutputOf(TEXT, ANSWER, shown)?.render();
    expect(element?.querySelector('.recipe-plan__progress-text')?.textContent).toBe(
      'Applying: 0 of 1 done · sent 48 of 100 MB',
    );
    element?.querySelector<HTMLButtonElement>('[data-action="cancel-apply"]')?.click();
    expect(shown.cancel).toHaveBeenCalledTimes(1);

    const said = "'apply together' stopped at cell 2: its Apply did not go through.";
    const after = togetherOutputOf(
      TEXT,
      ANSWER,
      context({ state: { applying: false, said } }),
    )?.render();
    expect(after?.querySelector('[role="alert"]')?.textContent).toBe(said);
  });

  it('draws no Apply on a plan cell under the header, and one without it', () => {
    const actions = {
      runFrom: vi.fn(),
      fetchAgain: vi.fn(),
      toggled: vi.fn(),
      expandedIncluded: vi.fn(),
      apply: vi.fn(),
      rows: vi.fn(() => Promise.resolve({ stale: true as const })),
      copy: vi.fn(() => Promise.resolve({ stale: true as const })),
      facets: vi.fn(() => Promise.resolve({ stale: true as const })),
      row: vi.fn(() => Promise.resolve({ stale: true as const })),
      openTab: vi.fn(),
    } satisfies CellViewActions;
    const [, status] = cellStatuses(TEXT, ANSWER, 'en');
    if (status === undefined) throw new Error('a status');
    const base = {
      locale: 'en' as const,
      collapsed: new Set<number>(),
      expanded: new Set<number>(),
      applying: new Set<number>(),
      refusals: new Map<number, string>(),
      now: () => 0,
      actions,
    };
    const under = cellOutputOf(status, { ...base, together: true }).render();
    const plain = cellOutputOf(status, base).render();
    expect(under.querySelector('[data-action="apply"]')).toBeNull();
    expect(plain.querySelector('[data-action="apply"]')).not.toBeNull();
  });
});

describe("the notebook's Apply all", () => {
  it('asks once, shows the cells main applied, and keeps where it stopped until the next run', async () => {
    let answerTogether: ((answer: RecipeApplyTogetherAnswer) => void) | undefined;
    const asked: string[] = [];
    const shows: RecipeRunAnswer[] = [];
    const notebook = createRecipeNotebook({
      run: (request) => Promise.resolve({ ...ANSWER, requestId: request.requestId }),
      apply: () => Promise.resolve({}),
      applyTogether: (request) => {
        asked.push(request.documentId);
        return new Promise((resolve) => {
          answerTogether = resolve;
        });
      },
      refusedWithoutReason: () => 'Not applied',
      textOf: () => TEXT,
      show: (_documentId, _text, answer) => shows.push(answer),
      delay: 0,
    });
    await notebook.runNow('ship', 'explicit');

    const going = notebook.applyTogether('ship');
    void notebook.applyTogether('ship');
    expect(notebook.togetherOf('ship').applying).toBe(true);
    notebook.progressed({ documentId: 'ship', index: 1, done: 0, total: 1, note: 'one' });
    notebook.progressed({ documentId: 'ship', index: 2, done: 0, total: 1, note: 'two' });
    expect([...notebook.progressOf('ship').keys()]).toEqual([2]);

    answerTogether?.({
      cells: [planCell(1, 7, true), planCell(2, 8)],
      diagnostics: [
        {
          code: 'E_RECIPE_APPLY_TOGETHER',
          severity: 'error',
          message: "'apply together' stopped at cell 3.",
        },
      ],
    });
    await going;

    expect(asked).toEqual(['ship']);
    expect(notebook.togetherOf('ship')).toEqual({
      applying: false,
      said: "'apply together' stopped at cell 3.",
    });
    const cells = notebook.lastOf('ship')?.answer.cells ?? [];
    expect(cells.map((cell) => cell.applied?.applied ?? null)).toEqual([null, 1, null]);
    expect(notebook.progressOf('ship').size).toBe(0);

    await notebook.runNow('ship', 'explicit');
    expect(notebook.togetherOf('ship').said).toBeUndefined();
    expect(shows.length).toBeGreaterThan(2);
  });
});
