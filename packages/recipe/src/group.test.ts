import { err } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import tasksJson from './__fixtures__/tasks.json';
import { checkTable } from './check-table.js';
import { parseRecipe } from './parse.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import type { CellValue, Row, Table } from './table.js';

const tasks = tasksJson as unknown as Table;

async function run(lines: readonly string[], input: Table = tasks) {
  const parsed = parseRecipe(['recipe test', ...lines].join('\n'));
  if (!parsed.ok) throw new Error(parsed.error.map(({ message }) => message).join('\n'));
  const result = await runRecipe(parsed.value, {
    input,
    verbs: createVerbRegistry(),
    derivations: createDerivationRegistry(),
    resolveRecipe: () => Promise.resolve(err([])),
  });
  if (!result.ok) throw new Error('a run with a table always answers');
  const failed = result.value.cells.flatMap((cell) => cell.diagnostics);
  return { table: result.value.table, problems: failed };
}

const keys = (table: Table | undefined) => table?.rows.map((row) => row.key);
const column = (table: Table | undefined, name: string) =>
  table?.rows.map((row) => row.values[name] ?? null);

/** A table of `kind`, `labels` and fetch times, keyed `T-0`, `T-1`… in order. */
function labelled(rows: readonly (readonly [string | null, CellValue, string])[]): Table {
  return {
    columns: [
      { name: 'key', type: 'text', origin: 'test' },
      { name: 'kind', type: 'text', origin: 'test' },
      { name: 'labels', type: 'list', origin: 'test' },
    ],
    rows: rows.map(([kind, labels, fetchedAt], index): Row => {
      const key = `T-${String(index)}`;
      return {
        key,
        values: { key, kind, labels },
        provenance: { source: 'test', id: key, fetchedAt },
      };
    }),
  };
}

describe('group', () => {
  it('collapses the demo tasks into one row per kind and team, in first-appearance order', async () => {
    const { table, problems } = await run(['group by=kind,team']);
    expect(problems).toEqual([]);
    expect(table?.columns).toEqual([
      { name: 'kind', type: 'text', origin: 'demo' },
      { name: 'team', type: 'text', origin: 'demo' },
      { name: 'rows', type: 'list', origin: 'group' },
    ]);
    expect(keys(table)).toEqual([
      '["anuncio","design"]',
      '["copy","copy"]',
      '["video","video"]',
      '["post","design"]',
      '["anuncio",""]',
      '["post","copy"]',
    ]);
    // Accents and case fold as `where` folds them; the cell shows the spelling seen first.
    expect(column(table, 'kind')).toEqual(['anúncio', 'copy', 'vídeo', 'post', 'anuncio', 'post']);
    expect(column(table, 'rows')?.[0]).toEqual([
      'DEMO-1',
      'DEMO-4',
      'DEMO-5',
      'DEMO-10',
      'DEMO-11',
    ]);
    expect(table === undefined ? undefined : checkTable(table, 'group').ok).toBe(true);
  });

  it('keeps an empty cell as a group of its own', async () => {
    const { table } = await run(['group by=team']);
    expect(column(table, 'team')).toEqual(['design', 'copy', 'video', '']);
    expect(column(table, 'rows')?.[3]).toEqual(['DEMO-8']);
  });

  it('names a group by its compared values, so another first spelling keeps the key', async () => {
    const reversed: Table = { ...tasks, rows: [...tasks.rows].reverse() };
    const forward = await run(['group by=kind,team']);
    const backward = await run(['group by=kind,team'], reversed);
    expect(column(backward.table, 'kind')?.[0]).toBe('post');
    const byKey = (table: Table | undefined) =>
      Object.fromEntries((table?.rows ?? []).map((row) => [row.key, row.values['kind']]));
    expect(byKey(backward.table)['["anuncio","design"]']).toBe('anúncio');
    expect([...(keys(backward.table) ?? [])].sort()).toEqual(
      [...(keys(forward.table) ?? [])].sort(),
    );
  });

  it('dates a group by its oldest member and names it as its own provenance', async () => {
    const { table } = await run(
      ['group by=kind'],
      labelled([
        ['a', null, '2026-10-24T10:00:00.000Z'],
        ['A', null, '2026-10-24T08:00:00.000Z'],
        ['a', null, '2026-10-24T09:00:00.000Z'],
      ]),
    );
    expect(table?.rows[0]?.provenance).toEqual({
      source: 'group',
      id: '["a"]',
      fetchedAt: '2026-10-24T08:00:00.000Z',
    });
  });

  it('groups a list cell by its text', async () => {
    const { table } = await run(
      ['group by=labels'],
      labelled([
        ['a', ['Urgent', 'web'], '2026-10-24'],
        ['b', ['urgent', 'Web'], '2026-10-24'],
        ['c', ['web'], '2026-10-24'],
      ]),
    );
    expect(keys(table)).toEqual(['["urgent, web"]', '["web"]']);
    expect(column(table, 'labels')).toEqual([['Urgent', 'web'], ['web']]);
  });

  it('writes the member keys where into= says', async () => {
    const { table } = await run(['group by=team into=members']);
    expect(table?.columns.map((written) => written.name)).toEqual(['team', 'members']);
  });

  it('gives no group for an empty table, and no warning', async () => {
    const { table, problems } = await run(['group by=kind'], { ...tasks, rows: [] });
    expect(problems).toEqual([]);
    expect(table?.rows).toEqual([]);
  });

  it.each([
    ['group'],
    ['group kind'],
    ['group by=kind by=team'],
    ['group by=kind into=kind'],
    ['group by=kind,team into=TEAM'],
    ['group by=kind into=two words'],
    ['group by=kind colour=red'],
  ])('refuses %j', async (line) => {
    const { problems } = await run([line]);
    expect(problems[0]?.code).toBe('E_RECIPE_ARGUMENTS');
  });

  it('names a by= column the table lacks', async () => {
    const { problems } = await run(['group by=kind,tem']);
    expect(problems[0]?.code).toBe('E_RECIPE_UNKNOWN_COLUMN');
  });
});

describe('count', () => {
  it("counts each group's rows into a number column", async () => {
    const { table, problems } = await run(['group by=kind,team', 'count rows into=tasks']);
    expect(problems).toEqual([]);
    expect(table?.columns.at(-1)).toEqual({ name: 'tasks', type: 'number', origin: 'count rows' });
    expect(column(table, 'tasks')).toEqual([5, 2, 2, 1, 1, 1]);
  });

  it('counts any list column, into count when into= is not given, an empty cell as 0', async () => {
    const { table } = await run(
      ['count labels'],
      labelled([
        ['a', ['urgent', null], '2026-10-24'],
        ['b', null, '2026-10-24'],
        ['c', [], '2026-10-24'],
      ]),
    );
    expect(column(table, 'count')).toEqual([2, 0, 0]);
  });

  it.each([
    ['count'],
    ['count rows extra'],
    ['count rows into=kind'],
    ['count rows into=ROWS'],
    ['count rows into=a into=b'],
    ['count rows colour=red'],
  ])('refuses %j', async (line) => {
    const { problems } = await run(['group by=kind', line]);
    expect(problems[0]?.code).toBe('E_RECIPE_ARGUMENTS');
  });

  it('refuses a column that is not a list, rather than counting its characters', async () => {
    const { problems } = await run(['count title']);
    expect(problems[0]?.message).toContain("'title' is text");
  });
});
