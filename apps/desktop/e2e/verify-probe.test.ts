// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
  formatCells,
  formatPlugins,
  parseArguments,
  readRecipeCells,
  readTabs,
} from '../scripts/verify.js';
import { type CellViewContext, cellOutputOf } from '../src/renderer/recipe-cell-view.js';
import { type RecipeRunAnswer, cellStatuses } from '../src/renderer/recipe-notebook.js';

/**
 * The verification probe's logic (TYTO-651, ADR 0178), without a window: its arguments, and its
 * readers run against the cells the real views draw. Here and not in `scripts/`, because the
 * readers are page code and this folder's config is the one with both libraries.
 * `verification-mode.desktop.test.ts` runs the probe against a real window.
 */

type Cell = RecipeRunAnswer['cells'][number];

const TEXT = ['recipe weekly', 'acme.pull', 'example.mark done', ''].join('\n');

function context(): CellViewContext {
  return {
    locale: 'en',
    collapsed: new Set(),
    expanded: new Set(),
    applying: new Set(),
    refusals: new Map(),
    now: () => Date.parse('2026-11-09T12:00:00.000Z'),
    actions: {
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
    },
  };
}

/** The cells as the editor holds them: each output inside `#editor`. */
function drawCells(cells: readonly Cell[]): void {
  const answer = { requestId: 1, cells: [...cells], diagnostics: [], ranAt: '' };
  const editor = document.createElement('div');
  editor.id = 'editor';
  for (const status of cellStatuses(TEXT, answer, 'en')) {
    editor.append(cellOutputOf(status, context()).render());
  }
  document.body.replaceChildren(editor);
}

describe('the probe reads recipe cells as the window draws them', () => {
  it("prints each cell's status, and a plan's lines with their write, row and description", () => {
    drawCells([
      {
        index: 0,
        line: 2,
        status: 'ok',
        diagnostics: [],
        table: {
          columns: [{ name: 'key', type: 'text' }],
          rows: [{ key: 'T-1', values: ['T-1'] }],
          total: 1,
        },
      },
      {
        index: 1,
        line: 3,
        status: 'ok',
        diagnostics: [],
        plan: {
          target: 'example items',
          count: 2,
          operations: [
            { write: 'mark', rowKey: 'EX-1', description: 'Mark EX-1 done' },
            { write: 'mark', rowKey: 'EX-2', description: 'Mark EX-2 done' },
          ],
          applicable: false,
        },
      },
    ]);

    const cells = readRecipeCells();

    expect(cells.map((cell) => cell.planLines)).toEqual([
      [],
      ['mark · EX-1 · Mark EX-1 done', 'mark · EX-2 · Mark EX-2 done'],
    ]);
    expect(cells.every((cell) => cell.summary !== '')).toBe(true);
    process.stdout.write(`${formatCells(cells)}\n`);
  });

  it('says a failed cell failed', () => {
    drawCells([{ index: 0, line: 2, status: 'failed', diagnostics: [], source: true }]);

    expect(readRecipeCells().map((cell) => cell.failed)).toEqual([true]);
    expect(formatCells(readRecipeCells())).toMatch(/^cell 1: FAILED /u);
  });

  it('says so when no recipe is in front', () => {
    document.body.replaceChildren();
    expect(formatCells(readRecipeCells())).toBe('no recipe cells in front');
  });
});

describe('the probe reads the tabs', () => {
  it('marks the one in front', () => {
    // The tab's shape in `tabs.ts`: a div around the name button, which holds `aria-selected`.
    document.body.innerHTML = `<div class="tabs__tab"><button role="tab" aria-selected="false"
      >a.brief</button><button>×</button></div>
      <div class="tabs__tab tabs__tab--on"><button role="tab" aria-selected="true">  b.recipe
      </button><button>×</button></div>`;
    expect(readTabs()).toEqual(['  a.brief', '* b.recipe']);
  });
});

describe('the probe prints credentials as set or not set, never a value', () => {
  it('names the key and its state only', () => {
    const text = formatPlugins([
      { name: 'tyto-plugin-x', credentials: [{ key: 'token', set: true }] },
      { name: 'tyto-plugin-y', enabled: false, credentials: [{ key: 'api', set: false }] },
    ]);
    expect(text).toBe(
      [
        'tyto-plugin-x',
        '  credential token: set',
        'tyto-plugin-y (disabled)',
        '  credential api: not set',
      ].join('\n'),
    );
  });
});

describe("the probe's arguments", () => {
  const out = '/tmp/out';

  it('never picks a command, so nothing runs a recipe by default', () => {
    expect(parseArguments([], out)).toEqual({ error: 'no command given' });
    expect(parseArguments(['run'], out)).toEqual({ error: "unknown command 'run'" });
  });

  it('runs a recipe only when it is named, and fresh only when asked', () => {
    expect(parseArguments(['recipe'], out)).toMatchObject({ command: 'recipe', fresh: false });
    expect(parseArguments(['recipe', '--fresh', '--port', '9444'], out)).toMatchObject({
      command: 'recipe',
      fresh: true,
      port: 9444,
    });
  });

  it("refuses an option a read-only command does not take, and a port outside TCP's", () => {
    expect(parseArguments(['text', '--fresh'], out)).toEqual({
      error: "'--fresh' is not an option of 'text'",
    });
    expect(parseArguments(['tabs', '--port', '70000'], out)).toEqual({
      error: 'port 70000 is out of range',
    });
  });

  it('defaults to the port the launcher line opens', () => {
    expect(parseArguments(['screenshot'], out)).toMatchObject({ port: 9333, out });
  });
});
