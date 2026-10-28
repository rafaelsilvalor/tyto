// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  type RecipeRunAnswer,
  type RecipeRunRequest,
  cellAtOrAbove,
  cellStatuses,
  createRecipeNotebook,
} from './recipe-notebook.js';

/**
 * The window's side of the recipe notebook (TYTO-377): when a run is asked for, which answer is
 * kept, and the line under each cell. Main's runner is a stub that answers when the test says.
 */

const TEXT = ['recipe weekly', '# the team', 'acme.pull', 'where status = done', ''].join('\n');

type Cell = RecipeRunAnswer['cells'][number];

const table = (rows: number, columns: number): NonNullable<Cell['table']> => ({
  columns: Array.from({ length: columns }, (_, index) => ({ name: `c${index}`, type: 'text' })),
  rows: [],
  total: rows,
});

const answer = (requestId: number, cells: Cell[], held?: 'source' | 'restricted') => ({
  requestId,
  cells,
  diagnostics: [],
  ...(held === undefined ? {} : { held }),
  ranAt: '2026-10-28T12:00:00.000Z',
});

/** A notebook whose timers and runs the test drives by hand. */
function harness() {
  const asked: RecipeRunRequest[] = [];
  const replies: ((reply: RecipeRunAnswer) => void)[] = [];
  const shown: { documentId: string; text: string; requestId: number }[] = [];
  const timers: (() => void)[] = [];
  const texts = new Map([['tab-1', TEXT]]);
  const notebook = createRecipeNotebook({
    run: (request) => {
      asked.push(request);
      return new Promise((resolve) => replies.push(resolve));
    },
    textOf: (documentId) => texts.get(documentId),
    show: (documentId, text, reply) => {
      shown.push({ documentId, text, requestId: reply.requestId });
    },
    delay: 200,
    timers: {
      set: (run) => {
        timers.push(run);
        return timers.length - 1;
      },
      clear: (handle) => {
        timers[handle as number] = () => undefined;
      },
    },
  });
  return { notebook, asked, replies, shown, timers, texts };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('when a recipe runs', () => {
  it('runs once after a pause, however many keys came before it', async () => {
    const { notebook, asked, timers } = harness();
    notebook.typed('tab-1');
    notebook.typed('tab-1');
    notebook.typed('tab-1');
    for (const timer of timers) timer();
    await settle();

    expect(asked).toEqual([{ requestId: 1, documentId: 'tab-1', text: TEXT }]);
  });

  it('runs a save with saved and Run with explicit, at once, dropping a pause waiting', async () => {
    const { notebook, asked, timers } = harness();
    notebook.typed('tab-1');
    void notebook.runNow('tab-1', 'saved');
    void notebook.runNow('tab-1', 'explicit');
    for (const timer of timers) timer();
    await settle();

    expect(asked.map(({ requestId, saved, explicit }) => ({ requestId, saved, explicit }))).toEqual(
      [
        { requestId: 1, saved: true, explicit: undefined },
        { requestId: 2, saved: undefined, explicit: true },
      ],
    );
  });

  it('drops an answer that lands after a newer request for the same document', async () => {
    const { notebook, replies, shown } = harness();
    const first = notebook.runNow('tab-1', 'typed');
    const second = notebook.runNow('tab-1', 'saved');
    replies[1]?.(answer(2, []));
    replies[0]?.(answer(1, []));
    await Promise.all([first, second]);

    expect(shown.map((each) => each.requestId)).toEqual([2]);
  });

  it('runs from a cell and fetches again as Run, each carrying explicit (TYTO-377)', async () => {
    const { notebook, asked } = harness();
    void notebook.runFrom('tab-1', 2);
    void notebook.fetchAgain('tab-1');
    void notebook.runNow('tab-1', 'typed', {});
    await settle();

    expect(asked.map(({ explicit, from, fresh }) => ({ explicit, from, fresh }))).toEqual([
      { explicit: true, from: 2, fresh: undefined },
      { explicit: true, from: undefined, fresh: true },
      { explicit: undefined, from: undefined, fresh: undefined },
    ]);
  });

  it('shows every open recipe again with its last answer, and forgets a closed one', async () => {
    const { notebook, replies, shown, texts } = harness();
    texts.set('tab-2', 'recipe other');
    const first = notebook.runNow('tab-1', 'typed');
    const second = notebook.runNow('tab-2', 'typed');
    replies[0]?.(answer(1, []));
    replies[1]?.(answer(2, []));
    await Promise.all([first, second]);
    shown.length = 0;

    notebook.reshow();
    expect(shown).toEqual([
      { documentId: 'tab-1', text: TEXT, requestId: 1 },
      { documentId: 'tab-2', text: 'recipe other', requestId: 2 },
    ]);
    expect(notebook.lastOf('tab-2')?.answer.requestId).toBe(2);

    notebook.close('tab-2');
    shown.length = 0;
    notebook.reshow();
    expect(shown.map((each) => each.documentId)).toEqual(['tab-1']);
    expect(notebook.lastOf('tab-2')).toBeUndefined();
  });

  it('keeps which tables were folded per tab while it is open, and forgets them on close', () => {
    const { notebook } = harness();
    notebook.setCollapsed('tab-1', 0, true);
    notebook.setCollapsed('tab-1', 2, true);
    notebook.setCollapsed('tab-1', 0, false);

    expect([...notebook.collapsedOf('tab-1')]).toEqual([2]);
    expect([...notebook.collapsedOf('tab-2')]).toEqual([]);
    notebook.close('tab-1');
    expect([...notebook.collapsedOf('tab-1')]).toEqual([]);
  });

  it('drops every answer for a tab that closed, and asks nothing for a tab that is gone', async () => {
    const { notebook, asked, replies, shown, texts } = harness();
    const running = notebook.runNow('tab-1', 'typed');
    notebook.close('tab-1');
    replies[0]?.(answer(1, []));
    await running;
    texts.delete('tab-1');
    await notebook.runNow('tab-1', 'explicit');

    expect(shown).toEqual([]);
    expect(asked).toHaveLength(1);
  });
});

describe('the cell the cursor is in', () => {
  const at = (index: number, line: number): Cell => ({
    index,
    line,
    status: 'ok',
    diagnostics: [],
  });
  const cells = answer(1, [at(0, 3), at(1, 4), at(2, 7)]);

  it('is the nearest cell at or above the line, and the first above them all', () => {
    expect(cellAtOrAbove(cells, 4)).toBe(1);
    expect(cellAtOrAbove(cells, 6)).toBe(1);
    expect(cellAtOrAbove(cells, 9)).toBe(2);
    expect(cellAtOrAbove(cells, 1)).toBe(0);
    expect(cellAtOrAbove(answer(1, []), 4)).toBeUndefined();
  });
});

describe('the line under each cell', () => {
  const cell = (more: Partial<Cell>): Cell => ({
    index: 0,
    line: 3,
    status: 'ok',
    diagnostics: [],
    ...more,
  });

  it("goes under the cell's own line, in the text the request carried", () => {
    const [placed] = cellStatuses(TEXT, answer(1, [cell({ line: 4, table: table(1, 1) })]), 'en');
    expect(placed?.at).toBe(TEXT.indexOf('where'));
  });

  it("says a table's size, in both languages and in the singular", () => {
    const sizes = (rows: number, columns: number, locale: 'en' | 'pt-BR') =>
      cellStatuses(TEXT, answer(1, [cell({ table: table(rows, columns) })]), locale)[0]?.text;
    expect(sizes(12, 4, 'en')).toBe('12 rows · 4 columns');
    expect(sizes(12, 4, 'pt-BR')).toBe('12 linhas · 4 colunas');
    expect(sizes(1, 1, 'en')).toBe('1 row · 1 column');
  });

  it('says a failure, a held source, a folder not trusted and a plan', () => {
    const said = (
      each: Partial<Cell>,
      held?: 'source' | 'restricted',
      locale: 'en' | 'pt-BR' = 'en',
    ) => cellStatuses(TEXT, answer(1, [cell(each)], held), locale)[0];

    expect(said({ status: 'failed' })).toMatchObject({
      text: 'Failed: see Problems',
      failed: true,
    });
    expect(said({ status: 'failed' }, undefined, 'pt-BR')?.text).toBe('Falhou: veja Problemas');
    expect(said({ status: 'stale' }, 'source')?.text).toBe('Fetches on save or Run');
    expect(said({ status: 'stale' }, 'source', 'pt-BR')?.text).toBe(
      'Busca ao salvar ou em Executar',
    );
    expect(said({ status: 'stale' }, 'restricted')?.text).toBe(
      'Runs on Run: this folder is not trusted',
    );
    expect(said({ status: 'stale' }, 'restricted', 'pt-BR')?.text).toBe(
      'Só roda em Executar: esta pasta não é confiável',
    );
    expect(said({ status: 'stale' })?.text).toBe('Not run: the recipe has an error');
    expect(said({ status: 'skipped' })?.text).toBe('Skipped: a cell above failed');
    expect(said({ plan: { target: 'sheet', count: 3 } })?.text).toBe('Plan: 3 to write to sheet');
    // A cell that answered neither a table nor a plan has no line.
    expect(said({})).toBeUndefined();
  });
});
