import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ok } from '@tyto/core';
import type { RecipeContributions, RecipeVerbContribution } from '@tyto/plugin-api';
import type { RunClock, Table } from '@tyto/recipe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type RecipeRunInput, createRecipeRunner } from './recipe-runner.js';

/**
 * TYTO-681: a transform that reads remote data hears a run without cache as a source does
 * (ADR 0148), through the runner as the desktop and the CLI compose it (ADR 0188). The fixture
 * is a lookup that keeps what it read in a private cache (ADR 0138), as `google.sheet-lookup`
 * keeps a sheet, and counts each live read of its "remote" value.
 */

const clock: RunClock = { now: () => new Date('2026-11-12T12:00:00.000Z'), offsetMinutes: () => 0 };

const ROWS: Table = {
  columns: [{ name: 'key', type: 'text', origin: 'demo' }],
  rows: [
    {
      key: 'R-1',
      values: { key: 'R-1' },
      provenance: { source: 'demo', id: 'R-1', fetchedAt: '2026-11-12T09:00:00.000Z' },
    },
  ],
};

/** The remote value, the lookup's cache of it, and how many times the lookup read it live. */
interface Remote {
  value: string;
  cached: string | undefined;
  liveReads: number;
}

function contributionsOver(remote: Remote): RecipeContributions {
  const source: RecipeVerbContribution = {
    id: 'demo.rows',
    kind: 'source',
    arguments: [],
    page: () => Promise.resolve(ok({ table: ROWS })),
  };
  const lookup: RecipeVerbContribution = {
    id: 'demo.lookup',
    kind: 'transform',
    arguments: [],
    transform: (request) => {
      if (request.refresh === true || remote.cached === undefined) {
        remote.liveReads += 1;
        remote.cached = remote.value;
      }
      const looked = remote.cached;
      return Promise.resolve(
        ok({
          columns: [...request.table.columns, { name: 'looked', type: 'text', origin: 'demo' }],
          rows: request.table.rows.map((row) => ({
            ...row,
            values: { ...row.values, looked },
          })),
        }),
      );
    },
  };
  return {
    recipeVerbs: () => [source, lookup],
    ownedRecipeVerbs: () => [
      { plugin: 'demo', verb: source },
      { plugin: 'demo', verb: lookup },
    ],
    recipeDerivations: () => [],
  };
}

describe('a transform on a run without cache (TYTO-681)', () => {
  const TEXT = ['recipe lookup', 'demo.rows', 'demo.lookup'].join('\n');

  let scratch: string;
  let workspace: string;
  let recipePath: string;

  beforeEach(async () => {
    scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-recipe-refresh-')));
    workspace = join(scratch, 'promo');
    await mkdir(workspace, { recursive: true });
    recipePath = join(workspace, 'lookup.recipe');
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  function runnerOver(remote: Remote) {
    const runner = createRecipeRunner({
      contributions: contributionsOver(remote),
      placeOf: () => Promise.resolve({ trust: 'trusted', folder: workspace }),
      sectionFor: () => undefined,
      home: join(scratch, 'home'),
      clock: () => clock,
    });
    return async (input: Omit<RecipeRunInput, 'text' | 'path'>) => {
      const answer = await runner.run({ ...input, text: TEXT, path: recipePath });
      const lookupCell = answer.cells[1];
      expect(lookupCell?.diagnostics).toEqual([]);
      return lookupCell?.table?.rows[0]?.values['looked'];
    };
  }

  it('reads live on a fresh run and from its cache otherwise', async () => {
    const remote: Remote = { value: 'v1', cached: undefined, liveReads: 0 };
    const run = runnerOver(remote);

    // Run, then Run from the first cell again: the second reads its cache.
    expect(await run({ documentId: 'tab-1', explicit: true })).toBe('v1');
    remote.value = 'v2';
    expect(await run({ documentId: 'tab-1', explicit: true, from: 0 })).toBe('v1');
    expect(remote.liveReads).toBe(1);

    // Fetch again (ADR 0148 decision 10): `fresh` with `explicit`.
    expect(await run({ documentId: 'tab-1', explicit: true, fresh: true })).toBe('v2');
    expect(remote.liveReads).toBe(2);
  });

  it('reads live on a scheduled run, which the scheduler starts fresh (ADR 0175)', async () => {
    const remote: Remote = { value: 'v1', cached: undefined, liveReads: 0 };
    const run = runnerOver(remote);
    expect(await run({ documentId: 'tab-1', explicit: true })).toBe('v1');
    remote.value = 'v2';

    // What `recipe-schedule.ts` sends at each tick (TYTO-648, ADR 0175 note of 2026-11-11).
    const scheduled = { scheduled: true, from: 0, fresh: true } as const;
    expect(await run({ documentId: `schedule:${recipePath}`, ...scheduled })).toBe('v2');
    expect(remote.liveReads).toBe(2);
  });
});
