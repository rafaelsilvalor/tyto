import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ok } from '@tyto/core';
import type { RecipeContributions, RecipeVerbContribution } from '@tyto/plugin-api';
import type { JsonValue, RunClock, Table } from '@tyto/recipe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recipeStateStore } from '../recipe-state.js';

import { type RecipePlace, type RecipeRunInput, createRecipeRunner } from './recipe-runner.js';

/**
 * Apply in the notebook (TYTO-378, ADR 0170), through the runner as main composes it: a source,
 * `remember`, and an action modelled on the example plugin's `example.mark`, whose payload holds
 * the mark a row had when planned and whose `apply` fails a row whose mark moved since. The
 * state is the real store in a scratch `TYTO_HOME`; the plugin isolation is
 * `@tyto/plugin-api`'s, tested there.
 */

const NOW = '2026-11-07T12:00:00.000Z';
const clock: RunClock = { now: () => new Date(NOW), offsetMinutes: () => -180 };

const row = (key: string) => ({
  key,
  values: { key, status: 'open' },
  provenance: { source: 'acme', id: key, fetchedAt: '2026-11-07T09:00:00.000Z' },
});

const ITEMS: Table = {
  columns: [
    { name: 'key', type: 'text', origin: 'acme' },
    { name: 'status', type: 'text', origin: 'acme' },
  ],
  rows: [row('EX-1'), row('EX-2'), row('EX-3')],
};

interface Plugin {
  /** The marks the plugin keeps, by `label/row`, as the example keeps them in its cache. */
  readonly marks: Map<string, string>;
  /** How many operations `apply` was handed, over every call. */
  applied: number;
  /** TYTO-385: how many sources were fetched and plans made, over every call. */
  pulls: number;
  plans: number;
  /** TYTO-385: when set, every `apply` waits for it; and the most applies seen at once. */
  gate?: Promise<void> | undefined;
  applying: number;
  mostApplying: number;
}

function plugin(state: Plugin): RecipeContributions {
  const pull: RecipeVerbContribution = {
    id: 'acme.pull',
    kind: 'source',
    arguments: [],
    page: () => {
      state.pulls += 1;
      return Promise.resolve(ok({ table: ITEMS }));
    },
  };
  const mark: RecipeVerbContribution = {
    id: 'example.mark',
    kind: 'action',
    arguments: [{ name: 'label', type: 'text', positional: true, required: true }],
    writes: ['mark'],
    plan: ({ arguments: values, table }) => {
      state.plans += 1;
      const label = String(values.label);
      const operations = table.rows.map((each) => ({
        write: 'mark',
        rowKey: each.key,
        description: `Mark ${each.key} as '${label}'`,
        payload: {
          id: `${label}/${each.key}`,
          expected: state.marks.get(`${label}/${each.key}`) ?? null,
          mark: label,
        },
      }));
      return Promise.resolve(ok({ target: 'example items', operations, count: operations.length }));
    },
    apply: async ({ operations }) => {
      state.applying += 1;
      state.mostApplying = Math.max(state.mostApplying, state.applying);
      if (state.gate !== undefined) await state.gate;
      state.applying -= 1;
      state.applied += operations.length;
      const answers = operations.map((operation) => {
        const payload = operation.payload as { [key: string]: JsonValue };
        const id = String(payload.id);
        const now = state.marks.get(id) ?? null;
        if (now !== payload.expected) {
          return { status: 'failed' as const, reason: `${id} is marked '${String(now)}' now` };
        }
        state.marks.set(id, String(payload.mark));
        return { status: 'applied' as const };
      });
      return ok({ operations: answers });
    },
  };
  return {
    recipeVerbs: () => [pull, mark],
    ownedRecipeVerbs: () => [
      { plugin: 'example', verb: pull },
      { plugin: 'example', verb: mark },
    ],
    recipeDerivations: () => [],
  };
}

const SYNC = [
  'recipe sync',
  'acme.pull',
  'remember pushed columns=status',
  'example.mark done',
  '',
].join('\n');

let scratch: string;
let workspace: string;
let recipePath: string;
let home: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-recipe-apply-')));
  workspace = join(scratch, 'promo');
  home = join(scratch, 'home');
  await mkdir(join(workspace, 'recipes'), { recursive: true });
  recipePath = join(workspace, 'recipes', 'sync.recipe');
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function harness(trust: RecipePlace['trust'] = 'trusted') {
  const state: Plugin = {
    marks: new Map(),
    applied: 0,
    pulls: 0,
    plans: 0,
    applying: 0,
    mostApplying: 0,
  };
  const runner = createRecipeRunner({
    contributions: plugin(state),
    placeOf: () => Promise.resolve(trust === 'none' ? { trust } : { trust, folder: workspace }),
    sectionFor: () => undefined,
    home,
    clock: () => clock,
  });
  const run = (text: string, more: Partial<RecipeRunInput> = {}) =>
    runner.run({ documentId: 'tab-1', text, path: recipePath, ...more });
  const apply = (index: number, planId: number) =>
    runner.apply({ documentId: 'tab-1', index, planId, path: recipePath });
  /** What the recipe's `pushed` store holds, by key. */
  const stored = async () => {
    const entries = await recipeStateStore({ home, workspace, recipe: recipePath }).entries(
      'pushed',
    );
    if (!entries.ok) throw new Error('the store did not read');
    return Object.fromEntries([...entries.value].map(([key, entry]) => [key, entry.values]));
  };
  return { state, runner, run, apply, stored };
}

const codes = (cell: { diagnostics: readonly { code: string }[] } | undefined) =>
  cell?.diagnostics.map((found) => found.code);

describe('Apply in the notebook', () => {
  it('applies the shown plan, fails the row that moved, and remembers the others', async () => {
    const { state, run, apply, stored } = harness();
    const answer = await run(SYNC, { explicit: true });
    const planned = answer.cells[2];
    expect(planned?.plan?.count).toBe(3);
    expect(planned?.applicable).toBe(true);

    // The target of EX-2 moves between the plan and the click.
    state.marks.set('done/EX-2', 'review');
    const cell = await apply(2, planned?.planId ?? -1);

    expect(cell?.applied?.at).toBe(NOW);
    expect(cell?.applied?.operations).toEqual([
      { rowKey: 'EX-1', status: 'applied', appliedAt: NOW },
      { rowKey: 'EX-2', status: 'failed', reason: "done/EX-2 is marked 'review' now" },
      { rowKey: 'EX-3', status: 'applied', appliedAt: NOW },
    ]);
    expect(cell?.applicable).toBe(false);
    expect(cell?.diagnostics).toEqual([]);
    // State for the two applied rows only, each stamped when it applied.
    expect(await stored()).toEqual({
      'EX-1': { status: 'open', applied_at: NOW },
      'EX-3': { status: 'open', applied_at: NOW },
    });
  });

  it('refuses a plan id the cell no longer holds, and applies nothing', async () => {
    const { state, run, apply, stored } = harness();
    const first = await run(SYNC, { explicit: true });
    const stale = first.cells[2]?.planId ?? -1;
    // Planned again: the cell holds a new plan under a new id.
    const second = await run(SYNC.replace('mark done', 'mark ready'), { explicit: true });
    expect(second.cells[2]?.planId).not.toBe(stale);

    const cell = await apply(2, stale);

    expect(codes(cell)).toEqual(['E_RECIPE_APPLY']);
    expect(cell?.applied).toBeUndefined();
    expect(state.applied).toBe(0);
    expect(await stored()).toEqual({});
  });

  it('refuses to apply the same plan twice', async () => {
    const { state, run, apply } = harness();
    const answer = await run(SYNC, { explicit: true });
    const planId = answer.cells[2]?.planId ?? -1;

    await apply(2, planId);
    const again = await apply(2, planId);

    expect(codes(again)).toEqual(['E_RECIPE_APPLY']);
    expect(state.applied).toBe(3);
    // The first Apply's outcome stays on the cell.
    expect(again?.applied?.operations.map((operation) => operation.status)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);
  });

  it('serialises two clicks on the same plan: one applies, the other is refused', async () => {
    const { state, run, apply } = harness();
    const answer = await run(SYNC, { explicit: true });
    const planId = answer.cells[2]?.planId ?? -1;

    const [one, two] = await Promise.all([apply(2, planId), apply(2, planId)]);

    expect(state.applied).toBe(3);
    expect([codes(one), codes(two)]).toEqual([[], ['E_RECIPE_APPLY']]);
  });

  it('applies in a restricted folder on a click, as Run runs there', async () => {
    const { state, run, apply } = harness('restricted');
    const answer = await run(SYNC, { explicit: true });

    const cell = await apply(2, answer.cells[2]?.planId ?? -1);

    expect(cell?.applied?.operations).toHaveLength(3);
    expect(state.applied).toBe(3);
  });

  it('commits a plan cell never applied as skipped, so its rows keep their old state', async () => {
    const { run, apply, stored } = harness();
    const twoPlans = SYNC.replace('example.mark done\n', 'example.mark done\nexample.mark ready\n');
    const answer = await run(twoPlans, { explicit: true });

    await apply(2, answer.cells[2]?.planId ?? -1);
    // The second plan covers the same rows and was not applied: nothing of them is remembered.
    expect(await stored()).toEqual({});

    await apply(3, answer.cells[3]?.planId ?? -1);
    expect(Object.keys(await stored())).toEqual(['EX-1', 'EX-2', 'EX-3']);
  });

  it('applies but does not remember while another cell is stale, and says so', async () => {
    const { run, apply, stored } = harness();
    const withSourceAfter = `${SYNC}acme.pull\n`;
    await run(withSourceAfter, { explicit: true });
    // A pause in typing reruns the plan cell and stops before the source after it.
    const typed = await run(withSourceAfter.replace('mark done', 'mark ready'));
    expect(typed.cells.map((cell) => cell.status)).toEqual(['ok', 'ok', 'ok', 'stale']);

    const cell = await apply(2, typed.cells[2]?.planId ?? -1);

    expect(cell?.applied?.operations).toHaveLength(3);
    expect(codes(cell)).toEqual(['W_RECIPE_NOT_REMEMBERED']);
    expect(await stored()).toEqual({});
  });
});

describe('apply auto', () => {
  const AUTO = SYNC.replace('recipe sync\n', 'recipe sync\napply auto\n');

  it('applies the plans of a Run in a trusted folder, and commits', async () => {
    const { state, run, stored } = harness();

    const answer = await run(AUTO, { explicit: true });

    expect(state.applied).toBe(3);
    expect(answer.held).toBeUndefined();
    expect(answer.cells[2]?.applied?.operations).toHaveLength(3);
    expect(answer.cells[2]?.applicable).toBe(false);
    expect(Object.keys(await stored())).toEqual(['EX-1', 'EX-2', 'EX-3']);

    // Run again with nothing changed: no cell plans again, and a reused plan is never applied.
    await run(AUTO, { explicit: true });
    expect(state.applied).toBe(3);
  });

  it('stops at the plan in a restricted folder and outside any folder', async () => {
    for (const trust of ['restricted', 'none'] as const) {
      const { state, run } = harness(trust);

      // Outside a folder there is no state, so this recipe remembers nothing.
      const text = AUTO.replace('remember pushed columns=status\n', '');
      const answer = await run(text, { explicit: true });

      expect(answer.held).toBe('apply');
      expect(answer.cells[1]?.plan?.count).toBe(3);
      expect(answer.cells[1]?.applicable).toBe(true);
      expect(state.applied).toBe(0);
    }
  });

  it('never applies on a pause in typing or a save', async () => {
    const { state, run } = harness();

    const saved = await run(AUTO, { saved: true });
    const typed = await run(AUTO.replace('mark done', 'mark ready'));

    expect(saved.cells[2]?.plan?.count).toBe(3);
    expect(typed.cells[2]?.plan?.count).toBe(3);
    expect(typed.cells[2]?.status).toBe('ok');
    expect(state.applied).toBe(0);
  });
});

describe('a scheduled run (TYTO-385, ADR 0175)', () => {
  const AUTO = SYNC.replace('recipe sync\n', 'recipe sync\nevery 5m\napply auto\n');
  const scheduled = { documentId: 'schedule:sync', scheduled: true, from: 0 } as const;

  it('counts as Run in a trusted folder: fetches from the first cell and applies auto', async () => {
    const { state, run, stored } = harness();

    const first = await run(AUTO, scheduled);
    const second = await run(AUTO, scheduled);

    expect(first.held).toBeUndefined();
    expect(state.pulls).toBe(2);
    expect(state.applied).toBe(6);
    expect(second.cells[2]?.applied?.operations).toHaveLength(3);
    expect(Object.keys(await stored())).toEqual(['EX-1', 'EX-2', 'EX-3']);
  });

  it('runs nothing in a restricted folder or outside any workspace, held as restricted', async () => {
    for (const trust of ['restricted', 'none'] as const) {
      const { state, run } = harness(trust);

      const answer = await run(AUTO, scheduled);
      // Not even a syntax error is reported: nothing is parsed.
      const broken = await run(`${AUTO}every 1h\n`, scheduled);

      expect(answer).toEqual({ cells: [], diagnostics: [], held: 'restricted', ranAt: NOW });
      expect(broken.diagnostics).toEqual([]);
      expect(state.pulls).toBe(0);
      expect(state.applied).toBe(0);
    }
  });

  it("never applies at the same time as a tab's Apply of the same file", async () => {
    const { state, runner, run, apply } = harness();
    const tab = await run(SYNC, { explicit: true });
    let release = (): void => {};
    state.gate = new Promise((resolve) => {
      release = resolve;
    });

    const clicked = apply(2, tab.cells[2]?.planId ?? -1);
    const timed = runner.run({ text: AUTO, path: recipePath, ...scheduled });
    // The scheduled run has planned; give its Apply every chance to start beside the click's.
    while (state.plans < 2) await new Promise((resolve) => setTimeout(resolve, 5));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(state.applying).toBe(1);
    release();
    await Promise.all([clicked, timed]);

    expect(state.mostApplying).toBe(1);
    expect(state.applied).toBe(6);
  });
});
