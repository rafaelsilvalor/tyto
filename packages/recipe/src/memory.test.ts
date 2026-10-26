import { diagnostic, err } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import {
  STORED_AT,
  column,
  memoryState,
  runWithState as run,
} from './__fixtures__/state-harness.js';
import { type ApplyOutcome, type RecipeState, type StateWrite, stateToCommit } from './state.js';

const SHEET = tasks(
  ['status', 'owner', 'parent'],
  [
    ['doing', 'ana', 'P-1'],
    ['done', 'bia', 'P-1'],
    ['todo', 'caio', ''],
  ],
);

const applied: ApplyOutcome = { operations: [] };

describe('last', () => {
  it('reads null in every column for a row with no stored entry, a first run among them', async () => {
    const { table, errors } = await run(['last sync columns=status'], SHEET, memoryState());
    expect(errors).toEqual([]);
    expect(table?.columns.slice(-2).map(({ name, type }) => [name, type])).toEqual([
      ['last_status', 'text'],
      ['last_stored_at', 'datetime'],
    ]);
    expect(column(table, 'last_status')).toEqual([null, null, null]);
    expect(column(table, 'last_stored_at')).toEqual([null, null, null]);
  });

  it('brings every stored column by the row key, and when it was stored', async () => {
    const state = memoryState({
      sync: { 'T-0': { status: 'todo', owner: 'ana' }, 'T-2': { status: 'todo' } },
    });
    const { table, errors } = await run(['last sync'], SHEET, state);
    expect(errors).toEqual([]);
    expect(table?.columns.slice(-3).map(({ name }) => name)).toEqual([
      'last_owner',
      'last_status',
      'last_stored_at',
    ]);
    expect(column(table, 'last_status')).toEqual(['todo', null, 'todo']);
    expect(column(table, 'last_owner')).toEqual(['ana', null, null]);
    expect(column(table, 'last_stored_at')).toEqual([STORED_AT, null, STORED_AT]);
  });

  it('finds the entry by a column with by=, and an empty value finds none', async () => {
    const state = memoryState({ parents: { 'P-1': { status: 'review' } } });
    const { table, errors } = await run(['last parents by=parent columns=status'], SHEET, state);
    expect(errors).toEqual([]);
    expect(column(table, 'last_status')).toEqual(['review', 'review', null]);
  });

  it('writes its columns under another prefix', async () => {
    const state = memoryState({ sync: { 'T-1': { status: 'review' } } });
    const { table } = await run(['last sync prefix=before_'], SHEET, state);
    expect(column(table, 'before_status')).toEqual([null, 'review', null]);
    expect(column(table, 'before_stored_at')).toEqual([null, STORED_AT, null]);
  });

  it('refuses a column the table already has', async () => {
    const input = tasks(['status', 'last_status'], [['done', 'todo']]);
    const { errors, at } = await run(['last sync columns=status'], input, memoryState());
    expect(errors.map(({ code }) => code)).toEqual(['E_RECIPE_ARGUMENTS']);
    expect(errors[0]?.message).toContain('would add last_status');
    expect(at).toBe('sync columns=status');
  });

  it('fails without a store, never reading every row as a first run', async () => {
    const { table, errors, at } = await run(['last sync columns=status'], SHEET, undefined);
    expect(table).toBeUndefined();
    expect(errors.map(({ code }) => code)).toEqual(['E_RECIPE_STATE']);
    expect(errors[0]?.message).toBe(
      "Recipe state 'sync' cannot be used: this host keeps no recipe state between runs.",
    );
    expect(at).toBe('last');
  });

  it("reports the host's failure to read at the line", async () => {
    const broken: RecipeState = {
      ...memoryState(),
      read: (store) =>
        Promise.resolve(
          err([
            diagnostic('E_RECIPE_STATE', { store, problem: 'cannot be read: unreadable JSON' }),
          ]),
        ),
    };
    const { errors, at } = await run(['last sync'], SHEET, broken);
    expect(errors.map(({ code }) => code)).toEqual(['E_RECIPE_STATE']);
    expect(at).toBe('sync');
  });
});

describe('remember', () => {
  it('asks to store the listed columns of every row and writes nothing itself', async () => {
    const state = memoryState();
    const { run: ran, table, errors } = await run(['remember sync columns=status'], SHEET, state);
    expect(errors).toEqual([]);
    expect(table).toEqual(SHEET);
    expect(state.stores.size).toBe(0);
    expect(ran.remembers).toEqual([
      { kind: 'put', store: 'sync', rowKey: 'T-0', key: 'T-0', values: { status: 'doing' } },
      { kind: 'put', store: 'sync', rowKey: 'T-1', key: 'T-1', values: { status: 'done' } },
      { kind: 'put', store: 'sync', rowKey: 'T-2', key: 'T-2', values: { status: 'todo' } },
    ]);
  });

  it('merges into what is stored, keeping a column it does not list', async () => {
    const state = memoryState({ sync: { 'T-0': { status: 'todo', done_at: '01-10 16:17' } } });
    const first = await run(['remember sync columns=status'], SHEET, state);
    for (const commit of stateToCommit(first.run.remembers, applied)) {
      await state.write(commit.store, commit.puts, commit.deletes);
    }
    const second = await run(['last sync'], SHEET, state);
    expect(column(second.table, 'last_status')).toEqual(['doing', 'done', 'todo']);
    expect(column(second.table, 'last_done_at')).toEqual(['01-10 16:17', null, null]);
  });

  it('leaves alone the rows when= rejects, and forgets the ones forget-when= keeps', async () => {
    const { run: ran, errors } = await run(
      ['remember sync columns=status when="status != todo" forget-when="owner = bia"'],
      SHEET,
      memoryState(),
    );
    expect(errors).toEqual([]);
    expect(ran.remembers).toEqual([
      { kind: 'put', store: 'sync', rowKey: 'T-0', key: 'T-0', values: { status: 'doing' } },
      { kind: 'forget', store: 'sync', rowKey: 'T-1', key: 'T-1' },
    ]);
  });

  it('stores under a column with by=, skipping a row whose value is empty', async () => {
    const { run: ran } = await run(
      ['remember parents by=parent columns=owner'],
      SHEET,
      memoryState(),
    );
    expect(ran.remembers.map(({ rowKey, key }) => [rowKey, key])).toEqual([
      ['T-0', 'P-1'],
      ['T-1', 'P-1'],
    ]);
  });

  it('fails without a store, rather than remembering into nothing', async () => {
    const { errors } = await run(['remember sync columns=status'], SHEET, undefined);
    expect(errors.map(({ code }) => code)).toEqual(['E_RECIPE_STATE']);
  });

  it('needs columns=, and refuses a store name that is not a plain word', async () => {
    const missing = await run(['remember sync'], SHEET, memoryState());
    expect(missing.errors[0]?.message).toContain('needs columns=');
    const path = await run(['remember ../sync columns=status'], SHEET, memoryState());
    expect(path.errors[0]?.message).toContain('takes one store name');
    expect(path.at).toBe('../sync');
  });
});

describe('the state in an included recipe', () => {
  it('reaches the recipe `run` includes, which reads and remembers through it', async () => {
    const state = memoryState({ sync: { 'T-1': { status: 'review' } } });
    const {
      run: ran,
      table,
      errors,
    } = await run(['run inner'], SHEET, state, {
      inner: 'recipe inner\nlast sync columns=status\nremember sync columns=status',
    });
    expect(errors).toEqual([]);
    expect(column(table, 'last_status')).toEqual([null, 'review', null]);
    expect(ran.remembers).toHaveLength(3);
  });
});

describe('stateToCommit', () => {
  const remembers: readonly StateWrite[] = [
    { kind: 'put', store: 'sync', rowKey: 'T-0', key: 'T-0', values: { status: 'doing' } },
    { kind: 'put', store: 'sync', rowKey: 'T-1', key: 'T-1', values: { status: 'done' } },
    { kind: 'put', store: 'parents', rowKey: 'T-1', key: 'P-1', values: { status: 'review' } },
    { kind: 'forget', store: 'sync', rowKey: 'T-2', key: 'T-2' },
    { kind: 'put', store: 'sync', rowKey: 'T-3', key: 'T-3', values: { status: 'todo' } },
  ];

  it('commits nothing for a preview, which applied nothing', () => {
    expect(stateToCommit(remembers, undefined)).toEqual([]);
  });

  it('drops every write of a row with an operation that failed or never ran', () => {
    const outcome: ApplyOutcome = {
      operations: [
        { rowKey: 'T-0', status: 'applied' },
        { rowKey: 'T-1', status: 'applied' },
        { rowKey: 'T-1', status: 'failed' },
        { rowKey: 'T-3', status: 'skipped' },
      ],
    };
    expect(stateToCommit(remembers, outcome)).toEqual([
      { store: 'sync', puts: [{ key: 'T-0', values: { status: 'doing' } }], deletes: ['T-2'] },
    ]);
  });

  it('keeps every row when every operation applied', () => {
    const commits = stateToCommit(remembers, {
      operations: [{ rowKey: 'T-1', status: 'applied' }],
    });
    expect(commits).toEqual([
      {
        store: 'sync',
        puts: [
          { key: 'T-0', values: { status: 'doing' } },
          { key: 'T-1', values: { status: 'done' } },
          { key: 'T-3', values: { status: 'todo' } },
        ],
        deletes: ['T-2'],
      },
      { store: 'parents', puts: [{ key: 'P-1', values: { status: 'review' } }], deletes: [] },
    ]);
  });

  it('commits nothing when an operation that stands for no row failed', () => {
    expect(stateToCommit(remembers, { operations: [{ status: 'failed' }] })).toEqual([]);
  });

  it('folds writes to one key in order: puts merge, a forget starts it over', () => {
    const folded = stateToCommit(
      [
        { kind: 'put', store: 's', rowKey: 'T-0', key: 'K', values: { a: 1 } },
        { kind: 'put', store: 's', rowKey: 'T-1', key: 'K', values: { b: 2 } },
        { kind: 'forget', store: 's', rowKey: 'T-2', key: 'K' },
        { kind: 'put', store: 's', rowKey: 'T-3', key: 'K', values: { c: 3 } },
      ],
      applied,
    );
    expect(folded).toEqual([
      { store: 's', puts: [{ key: 'K', values: { c: 3 } }], deletes: ['K'] },
    ]);
  });
});
