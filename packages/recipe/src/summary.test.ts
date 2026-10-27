import { err } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import summaryRecipe from './__fixtures__/summary.recipe?raw';
import tasksJson from './__fixtures__/tasks.json';
import { parseRecipe } from './parse.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import { type Summary, summarize } from './summary.js';
import type { Table } from './table.js';

const tasks = tasksJson as unknown as Table;

async function run(source: string, input: Table = tasks) {
  const parsed = parseRecipe(source);
  if (!parsed.ok) throw new Error(parsed.error.map(({ message }) => message).join('\n'));
  const result = await runRecipe(parsed.value, {
    input,
    verbs: createVerbRegistry(),
    derivations: createDerivationRegistry(),
    resolveRecipe: () => Promise.resolve(err([])),
  });
  if (!result.ok) throw new Error('a run with a table always answers');
  return result.value;
}

/** The fixture recipe with `lines` inserted before its `show summary`. */
const withBeforeShow = (lines: readonly string[]) =>
  summaryRecipe.replace('show summary', [...lines, 'show summary'].join('\n'));

describe('the summary fixture recipe', () => {
  it('groups the demo tasks by kind and team and totals them, into the committed result', async () => {
    const ran = await run(summaryRecipe);
    expect(ran.cells.map((cell) => cell.status)).toEqual(Array(4).fill('ok'));
    expect(ran.view).toBe('summary');
    if (ran.table === undefined) throw new Error('the fixture recipe must produce a table');
    const summary = summarize(ran.table);
    expect(summary.rows.length).toBe(6);
    expect(summary.totals).toEqual({ tasks: 12 });
    await expect(oneRowPerLine(summary)).toMatchFileSnapshot(
      './__snapshots__/summary.expected.json',
    );
  });

  it('totals only the groups shown', async () => {
    const ran = await run(withBeforeShow(['where tasks >= 2']));
    if (ran.table === undefined) throw new Error('the recipe must produce a table');
    const summary = summarize(ran.table);
    expect(summary.rows.map((row) => row.values['tasks'])).toEqual([5, 2, 2]);
    expect(summary.totals).toEqual({ tasks: 9 });
  });
});

describe('summarize', () => {
  it('returns the rows as they are and sums each number column, an empty cell adding nothing', () => {
    const table: Table = {
      ...tasks,
      rows: tasks.rows.map((row, index) =>
        index === 0 ? { ...row, values: { ...row.values, points: null } } : row,
      ),
    };
    const summary = summarize(table);
    expect(summary.rows).toBe(table.rows);
    expect(summary.totals).toEqual({ points: 46 - 3 });
  });

  it('totals 0 over an empty table', () => {
    expect(summarize({ ...tasks, rows: [] }).totals).toEqual({ points: 0 });
  });
});

/** One column, one row and the totals per line, so a changed group is a one-line diff. */
function oneRowPerLine(summary: Summary): string {
  const block = (items: readonly unknown[]) =>
    items.map((item, index) => `    ${JSON.stringify(item)}${index < items.length - 1 ? ',' : ''}`);
  return [
    '{',
    '  "columns": [',
    ...block(summary.columns),
    '  ],',
    '  "rows": [',
    ...block(summary.rows),
    '  ],',
    `  "totals": ${JSON.stringify(summary.totals)}`,
    '}',
    '',
  ].join('\n');
}
