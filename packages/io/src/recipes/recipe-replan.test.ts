import { mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type TemplateManifest, diagnostic, err, ok, parseManifest } from '@tyto/core';
import type { RecipeContributions, RecipeVerbContribution } from '@tyto/plugin-api';
import type { JsonValue, RunClock, Table } from '@tyto/recipe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRecipeRunner } from './recipe-runner.js';

/**
 * TYTO-643, ADR 0170 note of 2026-11-12: after an Apply, the applied cell is planned again on
 * the next run, so its plan says what the Apply changed; the Apply itself plans nothing, and an
 * Apply that wrote nothing (refused, or every operation failed) leaves the cell as it was.
 * Through the runner as main composes it, with `to-brief` over a real workspace folder and an
 * action modelled on the example plugin's.
 */

const NOW = '2026-11-12T12:00:00.000Z';
const clock: RunClock = { now: () => new Date(NOW), offsetMinutes: () => 0 };

const lesson = (slug: string, title: string) => ({
  key: slug,
  values: { slug, title },
  provenance: { source: 'demo', id: slug, fetchedAt: '2026-11-12T09:00:00.000Z' },
});

const LESSONS: Table = {
  columns: [
    { name: 'slug', type: 'text', origin: 'demo' },
    { name: 'title', type: 'text', origin: 'demo' },
  ],
  rows: [
    lesson('lesson-1', 'First lesson'),
    lesson('lesson-2', 'Second lesson'),
    lesson('lesson-3', 'Third lesson'),
  ],
};

const MANIFEST = `name: aula
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
`;

function manifest(): TemplateManifest {
  const parsed = parseManifest(MANIFEST, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

interface Plugin {
  /** The marks the plugin keeps, by row. */
  readonly marks: Map<string, string>;
  /** How many sources were fetched, plans made and operations applied, over every call. */
  pulls: number;
  plans: number;
  applied: number;
  /** When set, `apply` answers an error as a whole and writes nothing. */
  broken: boolean;
}

function plugin(state: Plugin): RecipeContributions {
  const rows: RecipeVerbContribution = {
    id: 'demo.rows',
    kind: 'source',
    arguments: [],
    page: () => {
      state.pulls += 1;
      return Promise.resolve(ok({ table: LESSONS }));
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
      const operations = table.rows.map((each) => {
        const now = state.marks.get(each.key);
        return {
          write: 'mark',
          rowKey: each.key,
          description: `${each.key}: ${now === undefined ? 'unmarked' : `marked '${now}'`}`,
          payload: { id: each.key, mark: label },
        };
      });
      return Promise.resolve(ok({ target: 'example items', operations, count: operations.length }));
    },
    apply: ({ operations }) => {
      if (state.broken) {
        return Promise.resolve(
          err([diagnostic('E_RECIPE_APPLY', { verb: 'example.mark', problem: 'is offline' })]),
        );
      }
      state.applied += operations.length;
      for (const operation of operations) {
        const payload = operation.payload as { [key: string]: JsonValue };
        state.marks.set(String(payload.id), String(payload.mark));
      }
      return Promise.resolve(
        ok({ operations: operations.map(() => ({ status: 'applied' as const })) }),
      );
    },
  };
  return {
    recipeVerbs: () => [rows, mark],
    ownedRecipeVerbs: () => [
      { plugin: 'demo', verb: rows },
      { plugin: 'example', verb: mark },
    ],
    recipeDerivations: () => [],
  };
}

const BRIEFS = [
  'recipe lessons',
  'demo.rows',
  'to-brief template=aula into=../briefs name=slug slots=titulo:title',
  '',
].join('\n');

const MARK = ['recipe marks', 'demo.rows', 'example.mark done', 'select slug', ''].join('\n');

let scratch: string;
let workspace: string;
let recipePath: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-recipe-replan-')));
  workspace = join(scratch, 'promo');
  await mkdir(join(workspace, 'recipes'), { recursive: true });
  recipePath = join(workspace, 'recipes', 'lessons.recipe');
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function harness() {
  const state: Plugin = { marks: new Map(), pulls: 0, plans: 0, applied: 0, broken: false };
  const runner = createRecipeRunner({
    contributions: plugin(state),
    placeOf: () => Promise.resolve({ trust: 'trusted', folder: workspace }),
    sectionFor: () => undefined,
    home: join(scratch, 'home'),
    clock: () => clock,
    templates: (name) => Promise.resolve(name === 'aula' ? manifest() : undefined),
  });
  /** Run, as the notebook's Run button does: from the first cell that changed. */
  const run = (text: string) =>
    runner.run({ documentId: 'tab-1', text, path: recipePath, explicit: true });
  const apply = (index: number, planId: number) =>
    runner.apply({ documentId: 'tab-1', index, planId, path: recipePath });
  return { state, run, apply };
}

const descriptions = (cell: { plan?: { operations: readonly { description: string }[] } }) =>
  cell.plan?.operations.map((operation) => operation.description);

describe('a plan cell after Apply (TYTO-643)', () => {
  it('plans to-brief again on the next Run, which now reads overwrites for every brief', async () => {
    const { state, run, apply } = harness();
    const first = await run(BRIEFS);
    const cell = first.cells[1];
    expect(cell?.diagnostics).toEqual([]);
    expect(cell && descriptions(cell)).toEqual([
      'briefs/lesson-1.brief: new',
      'briefs/lesson-2.brief: new',
      'briefs/lesson-3.brief: new',
    ]);

    const applied = await apply(1, cell?.planId ?? -1);
    expect(applied?.applied?.operations.map((operation) => operation.status)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);
    expect((await readdir(join(workspace, 'briefs'))).sort()).toEqual([
      'lesson-1.brief',
      'lesson-2.brief',
      'lesson-3.brief',
    ]);

    // The recipe is not edited: Run again.
    const again = await run(BRIEFS);
    const replanned = again.cells[1];

    expect(replanned && descriptions(replanned)).toEqual([
      'briefs/lesson-1.brief: overwrites',
      'briefs/lesson-2.brief: overwrites',
      'briefs/lesson-3.brief: overwrites',
    ]);
    expect(replanned?.planId).not.toBe(cell?.planId);
    expect(replanned?.applied).toBeUndefined();
    expect(replanned?.applicable).toBe(true);
    // The source above it is reused, not fetched again.
    expect(state.pulls).toBe(1);
  });

  it("plans an action plugin's applied cell again on the next Run, and not before", async () => {
    const { state, run, apply } = harness();
    const first = await run(MARK);
    expect(state.plans).toBe(1);

    const applied = await apply(1, first.cells[1]?.planId ?? -1);
    expect(applied?.applied?.operations).toHaveLength(3);
    // The Apply wrote and planned nothing more: the plugin is called again only on a run.
    expect(state.plans).toBe(1);
    expect(applied && descriptions(applied)).toEqual([
      'lesson-1: unmarked',
      'lesson-2: unmarked',
      'lesson-3: unmarked',
    ]);

    const again = await run(MARK);

    expect(state.plans).toBe(2);
    expect(state.pulls).toBe(1);
    expect(again.cells.map((cell) => cell.status)).toEqual(['ok', 'ok', 'ok']);
    expect(again.cells[1] && descriptions(again.cells[1])).toEqual([
      "lesson-1: marked 'done'",
      "lesson-2: marked 'done'",
      "lesson-3: marked 'done'",
    ]);
    expect(again.cells[1]?.planId).not.toBe(first.cells[1]?.planId);

    // That new plan, not applied, is reused by the run after.
    await run(MARK);
    expect(state.plans).toBe(2);
  });

  it('leaves the cell as it was after a failed Apply, so the next Run reuses its plan', async () => {
    const { state, run, apply } = harness();
    const first = await run(MARK);
    state.broken = true;

    // The batch fails as a whole: every operation answers failed (ADR 0170 decision 2).
    const failed = await apply(1, first.cells[1]?.planId ?? -1);
    expect(failed?.applied?.operations.map((operation) => operation.status)).toEqual([
      'failed',
      'failed',
      'failed',
    ]);

    const again = await run(MARK);

    expect(state.plans).toBe(1);
    expect(state.applied).toBe(0);
    expect(again.cells[1]?.planId).toBe(first.cells[1]?.planId);
    expect(again.cells[1]?.applied).toEqual(failed?.applied);
  });

  it('leaves the cell as it was after a refused Apply', async () => {
    const { state, run, apply } = harness();
    const first = await run(MARK);

    const refused = await apply(1, (first.cells[1]?.planId ?? -1) + 1000);
    expect(refused?.diagnostics.map((found) => found.code)).toEqual(['E_RECIPE_APPLY']);

    const again = await run(MARK);

    expect(state.plans).toBe(1);
    expect(again.cells[1]?.planId).toBe(first.cells[1]?.planId);
    expect(again.cells[1]?.applicable).toBe(true);
    expect(again.cells[1]?.applied).toBeUndefined();
  });
});
