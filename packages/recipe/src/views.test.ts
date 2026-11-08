import { err, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import tasksJson from './__fixtures__/tasks.json';
import { parseRecipe } from './parse.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { type RunOptions, runRecipe } from './run.js';
import type { Table } from './table.js';
import { compareCells } from './verbs.js';
import type { ViewSpecs } from './views.js';

const tasks = tasksJson as unknown as Table;

/** A host's views as ADR 0171 has them: names and the arguments each reads. */
const views: ViewSpecs = {
  table: [],
  board: [
    { name: 'by', kind: 'column', required: true, types: ['text'] },
    { name: 'fields', kind: 'columns' },
    { name: 'order', kind: 'values' },
  ],
  calendar: [
    { name: 'date', kind: 'column', required: true },
    { name: 'span', kind: 'choice', values: ['week', 'month'] },
  ],
};

async function run(lines: readonly string[], extra: Partial<RunOptions> = {}) {
  const source = ['recipe test', ...lines].join('\n');
  const parsed = parseRecipe(source);
  if (!parsed.ok) throw new Error(parsed.error.map(({ message }) => message).join('\n'));
  const result = await runRecipe(parsed.value, {
    input: tasks,
    verbs: createVerbRegistry(),
    derivations: createDerivationRegistry(),
    resolveRecipe: () => Promise.resolve(err([])),
    views,
    ...extra,
  });
  if (!result.ok) throw new Error('expected the run to start');
  const problem = result.value.cells.flatMap((cell) => cell.diagnostics)[0];
  const at =
    problem?.range === undefined ? undefined : source.slice(problem.range.start, problem.range.end);
  return { run: result.value, problem, at };
}

describe('show against the host views (ADR 0171)', () => {
  it('names an unknown view at its word, with a suggestion', async () => {
    const { problem, at } = await run(['show tables']);
    expect(problem?.code).toBe('E_RECIPE_VIEW');
    expect(problem?.message).toBe(
      "No view named 'tables' is drawn here. Available: table, board, calendar.",
    );
    expect(problem?.hint).toBe("Did you mean 'table'?");
    expect(at).toBe('tables');
  });

  it('names an unknown column at its argument, with a suggestion', async () => {
    const { problem, at } = await run(['show board by=stauts']);
    expect(problem?.code).toBe('E_RECIPE_UNKNOWN_COLUMN');
    expect(problem?.hint).toBe("Did you mean 'status'?");
    expect(at).toBe('by=stauts');
  });

  it('resolves a column through an alias to its canonical name', async () => {
    const { run: result, problem } = await run(['show board by=estado fields=Title,pontos'], {
      aliases: { estado: 'status', pontos: 'points' },
    });
    expect(problem).toBeUndefined();
    expect(result.cells[0]?.view).toEqual({
      name: 'board',
      options: { by: 'status', fields: ['title', 'points'] },
    });
  });

  it('refuses a missing required argument at the whole line', async () => {
    const { problem, at } = await run(['show board']);
    expect(problem?.message).toBe("'show' needs by= for the board view.");
    expect(at).toBe('board');
  });

  it('refuses a stray positional word at that word', async () => {
    const { problem, at } = await run(['show board status']);
    expect(problem?.code).toBe('E_RECIPE_ARGUMENTS');
    expect(at).toBe('status');
  });

  it('refuses an argument the view does not read, a wrong column type and a bad choice', async () => {
    const stray = await run(['show table by=status']);
    expect(stray.problem?.message).toBe(
      "'show' does not take 'by=' for the table view; it accepts none.",
    );
    expect(stray.at).toBe('by=status');
    const typed = await run(['show board by=points']);
    expect(typed.problem?.message).toBe("'show' by= reads a text column, and 'points' is number.");
    const choice = await run(['show calendar date=due span=year']);
    expect(choice.problem?.message).toBe("'show' span= is 'year', and may be week, month.");
    expect(choice.at).toBe('span=year');
  });

  it('gives every cell the last show at or above it, and leaves the rows alone', async () => {
    const { run: result } = await run([
      'where status = done',
      'show board by=status order="To Do,Done"',
      'sort points desc',
      'show calendar date=due span=week',
    ]);
    expect(result.cells.map((cell) => cell.view?.name)).toEqual([
      undefined,
      'board',
      'board',
      'calendar',
    ]);
    expect(result.cells[1]?.view?.options).toEqual({ by: 'status', order: ['To Do', 'Done'] });
    expect(result.cells[1]?.table).toBe(result.cells[0]?.table);
    expect(result.view).toBe('calendar');
  });

  // TYTO-381: a status order kept in the workspace, read as every verb reads a data file.
  it('reads a values argument from a data file, and refuses one that is not a list of words', async () => {
    const files: Record<string, unknown> = {
      './board.json': { order: ['To Do', 'Done'], wrong: [1, 2] },
    };
    const resolveData = (path: string) =>
      Promise.resolve(path in files ? ok(files[path]) : err([]));
    const read = await run(['show board by=status order=@./board.json#/order'], { resolveData });
    expect(read.problem).toBeUndefined();
    expect(read.run.cells[0]?.view?.options).toEqual({ by: 'status', order: ['To Do', 'Done'] });

    const misshapen = await run(['show board by=status order=@./board.json#/wrong'], {
      resolveData,
    });
    expect(misshapen.problem?.code).toBe('E_RECIPE_DATA_SHAPE');
    expect(misshapen.at).toBe('order=@./board.json#/wrong');
    const missing = await run(['show board by=status order=@./none.json#/order'], {
      resolveData,
    });
    expect(missing.problem?.code).toBe('E_RECIPE_DATA');
  });

  it('behaves as before when the host passes no list', async () => {
    const free = await run(['show anything'], { views: undefined });
    expect(free.problem).toBeUndefined();
    expect(free.run.cells[0]?.view).toEqual({ name: 'anything', options: {} });
    const named = await run(['show board by=status'], { views: undefined });
    expect(named.problem?.message).toBe("'show' does not take 'by='.");
  });
});

describe('the sort comparator', () => {
  it('puts numbers in numeric order and an empty value last in both directions', () => {
    const values = [10, null, 2, 33];
    expect([...values].sort((a, b) => compareCells(a, b, 1))).toEqual([2, 10, 33, null]);
    expect([...values].sort((a, b) => compareCells(a, b, -1))).toEqual([33, 10, 2, null]);
    expect(['b', 'Á', 'a'].sort((a, b) => compareCells(a, b, 1))).toEqual(['Á', 'a', 'b']);
  });
});
