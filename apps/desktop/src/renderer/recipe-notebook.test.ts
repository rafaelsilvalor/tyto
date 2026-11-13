// @vitest-environment jsdom
import { type EditorHandle, createEditor, mapLineStarts } from '@tyto/editor';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type RecipeApplyAnswer,
  type RecipeApplyRequest,
  type RecipeNotebook,
  type RecipeRunAnswer,
  type RecipeRunRequest,
  answerDiagnostics,
  blockResults,
  blockSlot,
  cellAtOrAbove,
  cellStatuses,
  columnsBefore,
  createRecipeNotebook,
  stepOnLine,
  stepSlot,
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
  const shown: { documentId: string; text: string; requestId: number; until?: number }[] = [];
  const applies: RecipeApplyRequest[] = [];
  const applied: ((reply: RecipeApplyAnswer) => void)[] = [];
  const lastShown: { answer?: RecipeRunAnswer } = {};
  const timers: (() => void)[] = [];
  const texts = new Map([['tab-1', TEXT]]);
  const notebook = createRecipeNotebook({
    run: (request) => {
      asked.push(request);
      return new Promise((resolve) => replies.push(resolve));
    },
    apply: (request) => {
      applies.push(request);
      return new Promise((resolve) => applied.push(resolve));
    },
    refusedWithoutReason: () => 'Not applied: run the recipe again',
    textOf: (documentId) => texts.get(documentId),
    show: (documentId, text, reply, until) => {
      shown.push({
        documentId,
        text,
        requestId: reply.requestId,
        ...(until === undefined ? {} : { until }),
      });
      lastShown.answer = reply;
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
  return { notebook, asked, replies, shown, timers, texts, applies, applied, lastShown };
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

  // TYTO-676, ADR 0195 and 0196: Run this block is Run from its first cell through its last.
  it('runs one block as Run, from its first cell and until its last', async () => {
    const { notebook, asked } = harness();
    void notebook.runBlock('tab-1', 2, 3);
    void notebook.runFrom('tab-1', 3);
    await settle();

    expect(asked.map(({ explicit, from, until }) => ({ explicit, from, until }))).toEqual([
      { explicit: true, from: 2, until: 3 },
      { explicit: true, from: 3, until: undefined },
    ]);
  });

  // The window says why the cells below a block run are stale: it hands the stop with the answer,
  // and again when it shows that answer again (a change of language).
  it('shows the answer of a block run with its stop, and again on reshow', async () => {
    const { notebook, replies, shown } = harness();
    const running = notebook.runBlock('tab-1', 1, 1);
    replies[0]?.(answer(1, []));
    await running;
    notebook.reshow();
    expect(shown.map(({ until }) => until)).toEqual([1, 1]);
    expect(notebook.lastOf('tab-1')?.until).toBe(1);
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

  describe('a fold follows its line through an edit (TYTO-451)', () => {
    let editor: EditorHandle | undefined;
    afterEach(() => {
      editor?.destroy();
      editor = undefined;
    });

    /** An editor on TEXT whose edits reach the notebook as `main.ts` hands them over. */
    const typedInto = (notebook: RecipeNotebook): EditorHandle => {
      const parent = document.createElement('div');
      document.body.append(parent);
      editor = createEditor(parent, { doc: TEXT });
      editor.onChange((_value, _view, edit) => {
        notebook.edited(
          'tab-1',
          (at) => mapLineStarts([at], edit.before, edit.changes, edit.after)[0],
        );
      });
      return editor;
    };
    const cell = (index: number, line: number): Cell => ({
      index,
      line,
      status: 'ok',
      diagnostics: [],
      table: table(2, 2),
    });
    /** The cells shown folded for an answer on `text`, by index, as the cell view reads them. */
    const foldedCells = (notebook: RecipeNotebook, text: string, cells: Cell[]): number[] =>
      cellStatuses(text, answer(1, cells), 'en')
        .filter((status) => notebook.collapsedOf('tab-1').has(status.at))
        .map((status) => status.index);

    it('keeps the folded cell folded when a step is inserted above it', () => {
      const { notebook } = harness();
      const on = typedInto(notebook);
      const shown = cellStatuses(TEXT, answer(1, [cell(0, 3), cell(1, 4)]), 'en');
      notebook.setCollapsed('tab-1', shown[0]?.at ?? -1, true);
      expect(foldedCells(notebook, TEXT, [cell(0, 3), cell(1, 4)])).toEqual([0]);

      // A step typed at the very start of `acme.pull`'s line, so above it: `acme.pull` moves
      // down a line and an index on, and the new step takes its old line and index.
      on.view.dispatch({ changes: { from: on.view.state.doc.line(3).from, insert: 'acme.x\n' } });

      const cells = [cell(0, 3), cell(1, 4), cell(2, 5)];
      expect(foldedCells(notebook, on.getValue(), cells)).toEqual([1]);
    });

    it('drops the fold of a line that was deleted, and keeps the others', () => {
      const { notebook } = harness();
      const on = typedInto(notebook);
      const shown = cellStatuses(TEXT, answer(1, [cell(0, 2), cell(1, 3)]), 'en');
      for (const status of shown) notebook.setCollapsed('tab-1', status.at, true);

      // Line 3 goes with its break: the line below takes its place, and must not take its fold.
      const line = on.view.state.doc.line(3);
      on.view.dispatch({ changes: { from: line.from, to: line.to + 1 } });

      expect(foldedCells(notebook, on.getValue(), [cell(0, 2), cell(1, 3)])).toEqual([0]);
      expect(notebook.collapsedOf('tab-1').size).toBe(1);
    });

    // TYTO-449: an opened `run` cell is kept the same way, and follows its line too.
    it('moves an opened run cell with its line, apart from the folds', () => {
      const { notebook } = harness();
      const on = typedInto(notebook);
      const shown = cellStatuses(TEXT, answer(1, [cell(0, 3), cell(1, 4)]), 'en');
      notebook.setExpanded('tab-1', shown[1]?.at ?? -1, true);
      expect([...notebook.collapsedOf('tab-1')]).toEqual([]);

      on.view.dispatch({ changes: { from: on.view.state.doc.line(3).from, insert: 'acme.x\n' } });

      const opened = cellStatuses(
        on.getValue(),
        answer(1, [cell(0, 3), cell(1, 4), cell(2, 5)]),
        'en',
      )
        .filter((status) => notebook.expandedOf('tab-1').has(status.at))
        .map((status) => status.index);
      expect(opened).toEqual([2]);
      notebook.setExpanded('tab-1', [...notebook.expandedOf('tab-1')][0] ?? -1, false);
      expect(notebook.expandedOf('tab-1').size).toBe(0);
    });

    it('maps nothing for a write by the host, which reports no edit', () => {
      const { notebook } = harness();
      const on = typedInto(notebook);
      notebook.setCollapsed('tab-1', 0, true);
      on.setValue(`# new\n${TEXT}`);
      expect([...notebook.collapsedOf('tab-1')]).toEqual([0]);
    });
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

// TYTO-642: a full-size tab follows its step's line, not its index.
describe('the cell a full-size tab draws', () => {
  let editor: EditorHandle | undefined;
  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  /** An editor on TEXT whose edits reach the notebook, and the harness's text, as in `main.ts`. */
  function typing() {
    const run = harness();
    const parent = document.createElement('div');
    document.body.append(parent);
    editor = createEditor(parent, { doc: TEXT });
    const on = editor;
    on.onChange((_value, _view, edit) => {
      run.texts.set('tab-1', on.getValue());
      run.notebook.edited(
        'tab-1',
        (at) => mapLineStarts([at], edit.before, edit.changes, edit.after)[0],
      );
    });
    return { ...run, on };
  }
  const cell = (index: number, line: number): Cell => ({
    index,
    line,
    status: 'ok',
    diagnostics: [],
    table: table(2, 2),
  });
  /** One cell per line from `first` down, as main answers a recipe with that many steps. */
  const steps = (first: number, count: number): Cell[] =>
    Array.from({ length: count }, (_, index) => cell(index, first + index));
  async function answered(
    run: ReturnType<typeof harness>,
    cells: Cell[],
    before?: () => void,
  ): Promise<void> {
    const running = run.notebook.runNow('tab-1', 'explicit');
    before?.();
    run.replies.at(-1)?.(answer(run.asked.length, cells));
    await running;
  }
  const insertAbove = (on: EditorHandle, line: number): void => {
    on.view.dispatch({ changes: { from: on.view.state.doc.line(line).from, insert: 'acme.x\n' } });
  };

  it('keeps drawing its step when a step is inserted above, before and after the next run', async () => {
    const run = typing();
    // `# the team`, `acme.pull` and `where …` are lines 2 to 4: cells 0, 1 and 2.
    await answered(run, steps(2, 3));
    run.notebook.followCell('view-1', 'tab-1', 2);
    expect(run.notebook.cellOfTab('view-1')).toBe(2);

    insertAbove(run.on, 3);
    // Until the next answer the tab draws the last one's cell 2, which is still its step.
    expect(run.notebook.cellOfTab('view-1')).toBe(2);

    await answered(run, steps(2, 4));
    // Its step is cell 3 now; cell 2 is `acme.pull`, which took no index from it.
    expect(run.notebook.cellOfTab('view-1')).toBe(3);
  });

  // TYTO-676: a block's toolbar asks for the cell on its line, as the text is now.
  it("finds a block's cell by its line through an edit, and none on a line no cell is on", async () => {
    const run = typing();
    await answered(run, steps(2, 3));
    const third = run.on.view.state.doc.line(4).from;
    expect(run.notebook.cellAt('tab-1', third)?.index).toBe(2);

    insertAbove(run.on, 3);
    expect(run.notebook.cellAt('tab-1', run.on.view.state.doc.line(5).from)?.index).toBe(2);
    expect(run.notebook.cellAt('tab-1', run.on.view.state.doc.line(3).from)).toBeUndefined();
  });

  it('follows its step through an edit made while the run was on its way', async () => {
    const run = typing();
    await answered(run, steps(2, 3));
    run.notebook.followCell('view-1', 'tab-1', 2);

    // The answer is for the text before the insert: its cell 2 is the tab's step all the same.
    await answered(run, steps(2, 3), () => {
      insertAbove(run.on, 3);
    });
    expect(run.notebook.cellOfTab('view-1')).toBe(2);
  });

  it('draws no cell once its line is deleted, not the neighbour that took its place', async () => {
    const run = typing();
    await answered(run, steps(2, 3));
    run.notebook.followCell('view-1', 'tab-1', 1);

    const line = run.on.view.state.doc.line(3);
    run.on.view.dispatch({ changes: { from: line.from, to: line.to + 1 } });
    expect(run.notebook.cellOfTab('view-1')).toBeUndefined();

    // The next run's cell 1 sits where the deleted step was: it is not the tab's.
    await answered(run, steps(2, 2));
    expect(run.notebook.cellOfTab('view-1')).toBeUndefined();
  });

  it("keeps a tab's view state apart from its cell's, and forgets both with the recipe", async () => {
    const run = typing();
    await answered(run, steps(2, 3));
    run.notebook.followCell('view-1', 'tab-1', 2);
    run.notebook.followCell('view-1', 'tab-1', 0);
    expect(run.notebook.cellOfTab('view-1')).toBe(2);
    run.notebook.keepTabView('view-1', { filter: 'odd' });
    run.notebook.keepView('tab-1', 0, { filter: 'even' });

    expect(run.notebook.tabViewOf('view-1')).toEqual({ filter: 'odd' });
    run.notebook.close('tab-1');
    expect(run.notebook.cellOfTab('view-1')).toBeUndefined();
    expect(run.notebook.tabViewOf('view-1')).toEqual({});
    expect(run.notebook.viewOf('tab-1', 0)).toEqual({});
  });
});

// TYTO-449: an included cell's lines are in another file; the `run` line already says its error.
describe('the diagnostics an answer marks in the editor', () => {
  it("are the file's and each cell's, never an included cell's", () => {
    const problem = (message: string) => ({ severity: 'error' as const, code: 'E_X', message });
    const marked = answerDiagnostics({
      diagnostics: [problem('file')],
      cells: [
        {
          index: 0,
          line: 2,
          status: 'ok',
          diagnostics: [problem('run line')],
          included: [
            {
              depth: 1,
              recipe: 'inner',
              index: 0,
              step: 'where x = 1',
              status: 'failed',
              diagnostics: [problem('inside')],
            },
          ],
        },
      ],
    });
    expect(marked.map((found) => found.message)).toEqual(['file', 'run line']);
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
    expect(
      said({ plan: { target: 'sheet', count: 3, operations: [], applicable: false } })?.text,
    ).toBe('Plan: 3 to write to sheet');
    // A cell that answered neither a table nor a plan has no line.
    expect(said({})).toBeUndefined();
  });
  // TYTO-676: Run this block stops after its cell; nothing failed below it.
  it('says a cell below the block run was not reached, and the block itself as any cell', () => {
    const stale = cell({ index: 2, status: 'stale', table: table(1, 1) });
    const ran = cell({ index: 1, table: table(2, 1) });
    const shown = cellStatuses(TEXT, answer(1, [ran, stale]), 'en', 1);
    expect(shown.map((each) => each.text)).toEqual([
      '2 rows · 1 column',
      'Below the block run: runs on the next run',
    ]);
    const portuguese = cellStatuses(TEXT, answer(1, [stale]), 'pt-BR', 1)[0]?.text;
    expect(portuguese).toBe('Abaixo do bloco executado: roda na próxima execução');
    // Without a stop, a stale cell with no reason is still the error's.
    expect(cellStatuses(TEXT, answer(1, [stale]), 'en')[0]?.text).toBe(
      'Not run: the recipe has an error',
    );
  });
});

describe('Apply (TYTO-378)', () => {
  const planCell = (more: Partial<Cell> = {}): Cell => ({
    index: 0,
    line: 3,
    status: 'ok',
    plan: {
      target: 'example items',
      count: 1,
      operations: [{ write: 'mark', rowKey: 'EX-1', description: 'Mark EX-1' }],
      planId: 7,
      applicable: true,
    },
    diagnostics: [],
    ...more,
  });

  async function shownPlan() {
    const made = harness();
    void made.notebook.runNow('tab-1', 'explicit');
    made.replies[0]?.(answer(1, [planCell()]));
    await settle();
    return made;
  }

  it('names the cell and its plan, holds the cell as applying, and shows the cell main answers', async () => {
    const { notebook, applies, applied, shown, lastShown } = await shownPlan();
    void notebook.apply('tab-1', 0, 7);
    void notebook.apply('tab-1', 0, 7);

    expect(applies).toEqual([{ documentId: 'tab-1', index: 0, planId: 7 }]);
    expect([...notebook.applyingOf('tab-1')]).toEqual([0]);
    expect(shown).toHaveLength(2);

    const done = planCell({
      plan: { ...(planCell().plan as NonNullable<Cell['plan']>), applicable: false },
      applied: {
        at: '2026-11-07T12:00:00.000Z',
        applied: 1,
        failed: 0,
        skipped: 0,
        operations: [{ status: 'applied' }],
      },
    });
    applied[0]?.({ cell: done });
    await settle();

    expect([...notebook.applyingOf('tab-1')]).toEqual([]);
    expect(lastShown.answer?.cells[0]?.applied?.applied).toBe(1);
    expect(notebook.lastOf('tab-1')?.answer.cells[0]).toEqual(done);
    expect(notebook.refusalsOf('tab-1').size).toBe(0);
  });

  it('keeps a refusal on the cell until the next run, and the plan as it was', async () => {
    const { notebook, applied, asked, replies } = await shownPlan();
    void notebook.apply('tab-1', 0, 7);
    applied[0]?.({
      cell: planCell({
        diagnostics: [
          {
            severity: 'error',
            code: 'E_RECIPE_APPLY',
            message: "Applying the plan of 'example.mark' was refused: it was applied already.",
          },
        ],
      }),
    });
    await settle();

    expect(notebook.refusalsOf('tab-1').get(0)).toBe(
      "Applying the plan of 'example.mark' was refused: it was applied already.",
    );
    expect(notebook.lastOf('tab-1')?.answer.cells[0]?.diagnostics).toEqual([]);

    void notebook.runNow('tab-1', 'explicit');
    replies[asked.length - 1]?.(answer(asked.length, [planCell()]));
    await settle();
    expect(notebook.refusalsOf('tab-1').size).toBe(0);
  });

  it('says a refusal with no reason, or no cell, in its own words', async () => {
    const { notebook, applied } = await shownPlan();
    void notebook.apply('tab-1', 0, 7);
    applied[0]?.({});
    await settle();

    expect(notebook.refusalsOf('tab-1').get(0)).toBe('Not applied: run the recipe again');
  });
});

describe('where Add step writes and what its form offers (TYTO-402)', () => {
  const RECIPE = [
    'recipe weekly',
    'param project = demo',
    'acme.pull',
    '# keep the open ones',
    'where status != done',
    '',
  ].join('\n');

  const cellWith = (index: number, columns: readonly string[] | undefined): Cell => ({
    index,
    line: index + 3,
    status: 'ok',
    diagnostics: [],
    ...(columns === undefined
      ? {}
      : {
          table: {
            columns: columns.map((name) => ({ name, type: 'text' })),
            rows: [],
            total: 0,
          },
        }),
  });

  // ADR 0196 amends ADR 0176: in a block the step joins it; elsewhere it starts a new block.
  it("writes at the end of the cursor's block, which grows by a step", () => {
    const slot = stepSlot(RECIPE, 4);
    const end = RECIPE.indexOf('done') + 'done'.length;

    expect(slot).toEqual({ at: end, prefix: '\n', suffix: '', before: 2 });
    const written = `${RECIPE.slice(0, slot.at)}${slot.prefix}select key${slot.suffix}${RECIPE.slice(slot.at)}`;
    expect(written.split('\n').slice(2, 6)).toEqual([
      'acme.pull',
      '# keep the open ones',
      'where status != done',
      'select key',
    ]);
  });

  it('writes a new block, set apart by a blank line, from the header or a blank line', () => {
    const header = RECIPE.indexOf('demo') + 'demo'.length;
    expect(stepSlot(RECIPE, 1)).toEqual({ at: header, prefix: '\n\n', suffix: '', before: 0 });
    const end = RECIPE.indexOf('done') + 'done'.length;
    expect(stepSlot(RECIPE, 6)).toEqual({ at: end, prefix: '\n\n', suffix: '', before: 2 });
    expect(stepSlot('recipe empty', 1)).toEqual({
      at: 'recipe empty'.length,
      prefix: '\n\n',
      suffix: '',
      before: 0,
    });
    expect(stepSlot('', 1)).toEqual({ at: 0, prefix: '', suffix: '\n', before: 0 });
  });

  it("finds the step on the cursor's line, and none on a comment", () => {
    expect(stepOnLine(RECIPE, 5)?.index).toBe(1);
    expect(stepOnLine(RECIPE, 5)?.step.verb).toBe('where');
    expect(stepOnLine(RECIPE, 4)).toBeUndefined();
  });

  it('offers the columns of the nearest cell before the step that has a table', () => {
    const cells = {
      cells: [cellWith(0, ['key', 'status']), cellWith(1, undefined), cellWith(2, ['key'])],
    };

    expect(columnsBefore(cells, 2)).toEqual(['key', 'status']);
    expect(columnsBefore(cells, 1)).toEqual(['key', 'status']);
    expect(columnsBefore(cells, 0)).toEqual([]);
    expect(columnsBefore(cells, undefined)).toEqual(['key']);
    expect(columnsBefore(undefined, 3)).toEqual([]);
  });
});

// TYTO-676, second pull request: the execution counter a block's gutter shows, and where its
// "+" writes. TEXT's steps are `acme.pull` (cell 0, line 3) and `where status = done` (1, 4).
describe('the execution counter (TYTO-676)', () => {
  const FIRST = '2026-11-12T10:00:00.000Z';
  const SECOND = '2026-11-12T11:00:00.000Z';
  const ran = (index: number, line: number, ranAt: string): Cell => ({
    index,
    line,
    status: 'ok',
    diagnostics: [],
    table: table(1, 1),
    ranAt,
  });
  const reply = (requestId: number, cells: Cell[], ranAt: string): RecipeRunAnswer => ({
    requestId,
    cells,
    diagnostics: [],
    ranAt,
  });
  async function ranOnce(run: ReturnType<typeof harness>): Promise<void> {
    const running = run.notebook.runNow('tab-1', 'typed');
    run.replies.at(-1)?.(reply(run.asked.length, [ran(0, 3, FIRST), ran(1, 4, FIRST)], FIRST));
    await running;
  }

  it('numbers what each run ran, a pause or a button alike, and a reused cell keeps its number', async () => {
    const run = harness();
    const typed = run.notebook.runNow('tab-1', 'typed');
    expect(run.notebook.executionOf('tab-1', TEXT)).toEqual([
      { state: 'running' },
      { state: 'running' },
    ]);
    run.replies[0]?.(reply(1, [ran(0, 3, FIRST), ran(1, 4, FIRST)], FIRST));
    await typed;
    expect(run.notebook.executionOf('tab-1', TEXT)).toEqual([
      { state: 'ran', count: 1 },
      { state: 'ran', count: 2 },
    ]);

    // Run this block on the second: main reuses the first, which keeps the run that made it.
    const block = run.notebook.runBlock('tab-1', 1, 1);
    expect(run.notebook.executionOf('tab-1', TEXT)).toEqual([
      { state: 'ran', count: 1 },
      { state: 'running' },
    ]);
    run.replies[1]?.(reply(2, [ran(0, 3, FIRST), ran(1, 4, SECOND)], SECOND));
    await block;
    expect(run.notebook.executionOf('tab-1', TEXT)).toEqual([
      { state: 'ran', count: 1 },
      { state: 'ran', count: 3 },
    ]);
  });

  it('marks stale what changed and every step below it, and never a note or a run not reached', async () => {
    const run = harness();
    await ranOnce(run);
    // Each text below has its lines where TEXT has them: a number is kept by its line's start.
    const marks = (text: string) =>
      run.notebook.executionOf('tab-1', text).map((mark) => mark.state);
    expect(marks(TEXT.replace('acme.pull', 'acme.pall'))).toEqual(['stale', 'stale']);
    expect(marks(TEXT.replace('status = done', 'status = open'))).toEqual(['ran', 'stale']);
    expect(marks(TEXT.replace('recipe weekly', 'recipe weakly'))).toEqual(['stale', 'stale']);
    // A param line written inside a step's block is still a header line: every step reads it.
    expect(marks(`${TEXT}param p = 1\n`)).toEqual(['stale', 'stale']);
    // A note does not run: editing it leaves every step as it ran.
    expect(marks(TEXT.replace('# the team', '# the tame'))).toEqual(['ran', 'ran']);
    // A step typed below has no number yet.
    expect(marks(`${TEXT}select key\n`)).toEqual(['ran', 'ran', 'never']);
  });

  it('marks stale a cell main answered stale, and follows a step to its new line', async () => {
    const run = harness();
    const first = run.notebook.runNow('tab-1', 'typed');
    run.replies[0]?.(reply(1, [ran(0, 3, FIRST), { ...ran(1, 4, FIRST), status: 'stale' }], FIRST));
    await first;
    expect(run.notebook.executionOf('tab-1', TEXT).map((mark) => mark.state)).toEqual([
      'ran',
      'never',
    ]);

    // Its number is kept by its line: a line inserted above moves it with the step.
    run.notebook.edited('tab-1', (at) => (at === 0 ? 0 : at + '# more\n'.length));
    const moved = TEXT.replace('# the team\n', '# the team\n# more\n');
    expect(run.notebook.executionOf('tab-1', moved)[0]).toEqual({ state: 'ran', count: 1 });
  });
});

describe('where a block\'s "+" writes (TYTO-676)', () => {
  it('goes above the block it stands over, as a block of its own, counting the steps above', () => {
    // Blocks: the header, and one of the note and both steps (ADR 0196): "+" makes a new one.
    expect(blockSlot(TEXT, 1)).toEqual({
      at: TEXT.indexOf('# the team'),
      prefix: '',
      suffix: '\n\n',
      before: 0,
    });
  });

  it('goes below the last block as a block of its own, the blank lines after it kept', () => {
    const text = `${TEXT}\n\n`;
    expect(blockSlot(text, 'end')).toEqual({
      at: text.indexOf('done') + 'done'.length,
      prefix: '\n\n',
      suffix: '',
      before: 2,
    });
  });
});

// TYTO-676, ADR 0196: a block draws its last step's result, and nothing under its other steps.
describe("a block's result", () => {
  const BLOCKS = [
    'recipe weekly',
    '',
    'acme.pull',
    '# keep the open ones',
    'where status = open',
    '',
    'select key',
    '',
  ].join('\n');
  const cell = (index: number, line: number): Cell => ({
    index,
    line,
    status: 'ok',
    diagnostics: [],
    table: table(1, 1),
  });

  it("draws only each block's last step, a lone step's too", () => {
    const statuses = cellStatuses(BLOCKS, answer(1, [cell(0, 3), cell(1, 5), cell(2, 7)]), 'en');
    expect(blockResults(BLOCKS, statuses).map((status) => status.index)).toEqual([1, 2]);
  });

  it("keeps every step's problems: they are the answer's, not the drawn lines'", () => {
    const failed: Cell = {
      ...cell(0, 3),
      status: 'failed',
      diagnostics: [
        {
          code: 'E_RECIPE_SYNTAX',
          severity: 'error',
          message: 'bad',
          range: { start: 21, end: 30 },
        },
      ],
    };
    const shown = answer(1, [failed, { ...cell(1, 5), status: 'skipped' }]);
    expect(answerDiagnostics(shown).map((found) => found.message)).toEqual(['bad']);
    expect(
      blockResults(BLOCKS, cellStatuses(BLOCKS, shown, 'en')).map((status) => status.text),
    ).toEqual(['Skipped: a cell above failed']);
  });
});
