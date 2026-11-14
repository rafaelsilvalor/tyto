import { err } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import tasksJson from './__fixtures__/tasks.json';
import { parseRecipe } from './parse.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { type RunOptions, runRecipe } from './run.js';
import type { Table } from './table.js';

const tasks = tasksJson as unknown as Table;

const options = (extra: Partial<RunOptions> = {}): RunOptions => ({
  input: tasks,
  verbs: createVerbRegistry(),
  derivations: createDerivationRegistry(),
  resolveRecipe: () => Promise.resolve(err([])),
  ...extra,
});

async function run(lines: readonly string[], extra: Partial<RunOptions> = {}) {
  const parsed = parseRecipe(['recipe test', ...lines].join('\n'));
  if (!parsed.ok) throw new Error(parsed.error.map(({ message }) => message).join('\n'));
  const result = await runRecipe(parsed.value, options(extra));
  if (!result.ok) throw new Error(result.error.map(({ message }) => message).join('\n'));
  return result.value;
}

const keys = (table: Table | undefined) => table?.rows.map((row) => row.key);

/** A one-column table of `points`, for the aggregates that compare. */
function pointsTable(values: readonly (string | number | null)[]): Table {
  return {
    columns: [{ name: 'points', type: 'text', origin: 'test' }],
    rows: values.map((value, index) => ({
      key: `R-${index + 1}`,
      values: { points: value },
      provenance: { source: 'test', id: `R-${index + 1}`, fetchedAt: '2026-11-14T09:00:00.000Z' },
    })),
  };
}

describe('set', () => {
  it('keeps a value the steps below filter on, and passes the table through', async () => {
    const result = await run(['set last_due = max due', 'where due = {last_due}']);
    const [set, where] = result.cells;
    expect(set?.named).toEqual({ name: 'last_due', value: '2026-12-01' });
    expect(set?.table).toBe(tasks);
    expect(keys(where?.table)).toEqual(['DEMO-8']);
  });

  it('reads the name written against its =, as x=max due', async () => {
    const result = await run(['set last_due=max due']);
    expect(result.cells[0]?.named).toEqual({ name: 'last_due', value: '2026-12-01' });
  });

  it.each([
    ['count', '12'],
    ['min due', '2026-10-20'],
    ['max due', '2026-12-01'],
    ['first key', 'DEMO-1'],
    ['last title', 'FAQ thread'],
    ['sum points', '46'],
    ['max points', '8'],
  ])('computes %s', async (aggregate, value) => {
    const result = await run([`set x = ${aggregate}`]);
    expect(result.cells[0]?.named).toEqual({ name: 'x', value });
  });

  it('compares as numbers only when every non-empty cell is one', async () => {
    const numbers = await run(['set x = max points'], { input: pointsTable(['9', 10, null]) });
    expect(numbers.cells[0]?.named?.value).toBe('10');
    const text = await run(['set x = max points'], { input: pointsTable(['9', '10', 'Ábaco']) });
    expect(text.cells[0]?.named?.value).toBe('Ábaco');
    const least = await run(['set x = min points'], { input: pointsTable(['9', '10', 'Ábaco']) });
    expect(least.cells[0]?.named?.value).toBe('10');
  });

  it('gives 0 rows to count and an empty value to the others, said in the note', async () => {
    const counted = await run(['where status = nothing', 'set x = count']);
    expect(counted.cells[1]?.named).toEqual({ name: 'x', value: '0' });
    expect(counted.cells[1]?.note).toBeUndefined();
    const empty = await run(['where status = nothing', 'set x = max due', 'select key']);
    expect(empty.cells[1]?.named).toEqual({ name: 'x', value: '' });
    expect(empty.cells[1]?.note).toBe("the table has no rows, so 'x' is empty");
    expect(empty.cells[1]?.diagnostics).toEqual([]);
    expect(empty.cells[2]?.status).toBe('ok');
  });

  it('refuses to sum a cell that is no number, naming its row', async () => {
    const result = await run(['set x = sum title']);
    expect(result.cells[0]?.status).toBe('failed');
    expect(result.cells[0]?.diagnostics[0]?.code).toBe('E_RECIPE_ARGUMENTS');
    expect(result.cells[0]?.diagnostics[0]?.message).toContain(
      "row 1 holds 'Spring sale banner' in 'title'",
    );
  });

  it.each([
    ['an aggregate it does not know', 'set x = median due', 'computes count, min'],
    ['a column for count', 'set x = count key', 'takes no column'],
    ['no column for max', 'set x = max', 'reads one column'],
    ['a column the table lacks', 'set x = max nothing', 'nothing'],
  ])('refuses %s', async (_case, line, message) => {
    const result = await run([line]);
    expect(result.cells[0]?.status).toBe('failed');
    expect(result.cells[0]?.diagnostics[0]?.message).toContain(message);
  });

  it('starts from the values a host hands on for the steps above the slice', async () => {
    const parsed = parseRecipe('recipe test\nset last_due = max due\nwhere due = {last_due}');
    if (!parsed.ok) throw new Error('expected the recipe to parse');
    const slice = { ...parsed.value, steps: parsed.value.steps.slice(1) };
    const result = await runRecipe(slice, options({ values: { last_due: '2026-11-02' } }));
    expect(result.ok && keys(result.value.table)).toEqual(['DEMO-1']);
  });
});

describe('const', () => {
  it('fills its placeholder like a parameter', async () => {
    const result = await run(['const kind = post', 'where kind = {kind}']);
    expect(keys(result.table)).toEqual(['DEMO-7', 'DEMO-12']);
  });

  it('takes no value from outside, and says it is a const', async () => {
    const parsed = parseRecipe('recipe test\nconst kind = post\nwhere kind = {kind}');
    if (!parsed.ok) throw new Error('expected the recipe to parse');
    const result = await runRecipe(parsed.value, options({ params: { kind: 'copy' } }));
    expect(result.ok ? undefined : result.error[0]?.message).toBe(
      "Parameter 'kind' was given a value, and it is a 'const' written in the recipe, which " +
        'takes no value from outside.',
    );
  });

  it("takes no value from a 'run' line either, and an included recipe's stay its own", async () => {
    const inner = parseRecipe(
      'recipe inner\nconst kind = post\nset n = count\nwhere kind = {kind}',
    );
    if (!inner.ok) throw new Error('expected the recipe to parse');
    const resolveRecipe = () => Promise.resolve(inner);
    const given = await run(['run inner kind=copy'], { resolveRecipe });
    expect(given.cells[0]?.diagnostics[0]?.message).toContain("it is a 'const'");
    expect(given.cells[0]?.diagnostics[0]?.code).toBe('E_RECIPE_PARAM');

    const outer = parseRecipe('recipe outer\nrun inner\nwhere key = {n}');
    expect(outer.ok).toBe(false);
    const included = await run(['run inner'], { resolveRecipe });
    expect(included.cells[0]?.named).toBeUndefined();
    expect(keys(included.table)).toEqual(['DEMO-7', 'DEMO-12']);
  });
});
