import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ok } from '@tyto/core';
import type { RecipeContributions, RecipeVerbContribution } from '@tyto/plugin-api';
import type { RunClock, Table } from '@tyto/recipe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type RecipeRunInput, createRecipeRunner } from './recipe-runner.js';

/**
 * TYTO-727, ADR 0199: a `set` cell's value reaches the steps below it when the notebook runs
 * only a slice of the recipe, and a `const` edited reruns every cell, as a parameter does.
 */

const clock: RunClock = { now: () => new Date('2026-11-14T12:00:00.000Z'), offsetMinutes: () => 0 };

function row(key: string, kind: string, due: string): Table['rows'][number] {
  return {
    key,
    values: { key, kind, due },
    provenance: { source: 'demo', id: key, fetchedAt: '2026-11-14T09:00:00.000Z' },
  };
}

const ROWS: Table = {
  columns: [
    { name: 'key', type: 'text', origin: 'demo' },
    { name: 'kind', type: 'text', origin: 'demo' },
    { name: 'due', type: 'date', origin: 'demo' },
  ],
  rows: [
    row('R-1', 'post', '2026-11-02'),
    row('R-2', 'copy', '2026-12-01'),
    row('R-3', 'post', '2026-11-20'),
  ],
};

/** A source whose pages are counted, so a test sees which runs reached it. */
function contributions(reads: { count: number }): RecipeContributions {
  const source: RecipeVerbContribution = {
    id: 'demo.rows',
    kind: 'source',
    arguments: [],
    page: () => {
      reads.count += 1;
      return Promise.resolve(ok({ table: ROWS }));
    },
  };
  return {
    recipeVerbs: () => [source],
    ownedRecipeVerbs: () => [{ plugin: 'demo', verb: source }],
    recipeDerivations: () => [],
  };
}

describe('named values in the notebook (TYTO-727)', () => {
  let scratch: string;
  let workspace: string;
  let recipePath: string;

  beforeEach(async () => {
    scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-recipe-set-')));
    workspace = join(scratch, 'promo');
    await mkdir(workspace, { recursive: true });
    recipePath = join(workspace, 'dues.recipe');
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  function runnerOver(reads: { count: number }) {
    const runner = createRecipeRunner({
      contributions: contributions(reads),
      placeOf: () => Promise.resolve({ trust: 'trusted', folder: workspace }),
      sectionFor: () => undefined,
      home: join(scratch, 'home'),
      clock: () => clock,
    });
    return (text: string, input: Omit<RecipeRunInput, 'text' | 'path' | 'documentId'> = {}) =>
      runner.run({ documentId: 'tab-1', explicit: true, ...input, text, path: recipePath });
  }

  const keys = (table: Table | undefined) => table?.rows.map((each) => each.key);

  const DUES = [
    'recipe dues',
    'demo.rows',
    '',
    'set last_due = max due',
    '',
    'where due = {last_due}',
  ].join('\n');

  it("leaves the cells below stale when only the set's block runs", async () => {
    const run = runnerOver({ count: 0 });
    const first = await run(DUES);
    expect(first.cells[1]?.named).toEqual({ name: 'last_due', value: '2026-12-01' });
    expect(keys(first.cells[2]?.table)).toEqual(['R-2']);

    const again = await run(DUES, { from: 1, until: 1 });
    expect(again.cells.map((cell) => cell.status)).toEqual(['ok', 'ok', 'stale']);
    expect(again.cells[1]?.named).toEqual({ name: 'last_due', value: '2026-12-01' });
  });

  it('filters a block run alone on the value its kept set cell computed', async () => {
    const reads = { count: 0 };
    const run = runnerOver(reads);
    await run(DUES);

    const below = await run(DUES, { from: 2 });
    expect(reads.count).toBe(1);
    expect(below.cells[2]?.status).toBe('ok');
    expect(below.cells[2]?.diagnostics).toEqual([]);
    expect(keys(below.cells[2]?.table)).toEqual(['R-2']);
  });

  it('runs every cell again when a const changes', async () => {
    const reads = { count: 0 };
    const run = runnerOver(reads);
    const text = (kind: string) =>
      ['recipe dues', `const kind = ${kind}`, 'demo.rows', 'where kind = {kind}'].join('\n');

    expect(keys((await run(text('post'))).cells[1]?.table)).toEqual(['R-1', 'R-3']);
    const edited = await run(text('copy'));
    expect(reads.count).toBe(2);
    expect(keys(edited.cells[1]?.table)).toEqual(['R-2']);
  });

  it('refuses a value given for a const, saying what it is', async () => {
    const run = runnerOver({ count: 0 });
    const answer = await run(['recipe dues', 'const kind = post', 'demo.rows'].join('\n'), {
      params: { kind: 'copy' },
    });
    expect(answer.diagnostics[0]?.code).toBe('E_RECIPE_PARAM');
    expect(answer.diagnostics[0]?.message).toContain("it is a 'const' written in the recipe");
  });
});
