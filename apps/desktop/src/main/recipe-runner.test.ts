import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ok } from '@tyto/core';
import type { RecipeContributions, RecipeState, RecipeVerbContribution } from '@tyto/plugin-api';
import type { RunClock, Table } from '@tyto/recipe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type RecipePlace,
  type RecipeRunInput,
  createRecipeRunner,
  oldestFetchedAt,
  readOnlyState,
} from './recipe-runner.js';

/**
 * The recipe notebook's runner (TYTO-377, ADR 0148), on a real folder for its data files and
 * included recipes, with a fixed clock and a plugin that counts every call. What a verb does is
 * `@tyto/recipe`'s; here it is which cells run, when, and against what.
 */

const NOW = '2026-10-27T12:00:00.000Z';
const clock: RunClock = { now: () => new Date(NOW), offsetMinutes: () => -180 };

const TASKS: Table = {
  columns: [
    { name: 'key', type: 'text', origin: 'acme' },
    { name: 'status', type: 'text', origin: 'acme' },
  ],
  rows: [
    {
      key: 'T-1',
      values: { key: 'T-1', status: 'done' },
      provenance: { source: 'acme', id: 'T-1', fetchedAt: '2026-10-27T09:30:00.000Z' },
    },
    {
      key: 'T-2',
      values: { key: 'T-2', status: 'open' },
      provenance: { source: 'acme', id: 'T-2', fetchedAt: '2026-10-27T08:15:00.000Z' },
    },
  ],
};

interface Calls {
  pull: number;
  tag: number;
  sections: unknown[];
  /** When set, the next pull waits for it. */
  gate?: Promise<void> | undefined;
}

/** One plugin, `acme-plugin`, with a source and a transform that count their calls. */
function acme(calls: Calls): RecipeContributions {
  const pull: RecipeVerbContribution = {
    id: 'acme.pull',
    kind: 'source',
    arguments: [{ name: 'team', type: 'text' }],
    page: async ({ section }) => {
      calls.pull += 1;
      calls.sections.push(section);
      const gate = calls.gate;
      calls.gate = undefined;
      if (gate !== undefined) await gate;
      return ok({ table: TASKS });
    },
  };
  const tag: RecipeVerbContribution = {
    id: 'acme.tag',
    kind: 'transform',
    arguments: [],
    transform: ({ table }) => {
      calls.tag += 1;
      return ok(table);
    },
  };
  return {
    recipeVerbs: () => [pull, tag],
    ownedRecipeVerbs: () => [
      { plugin: 'acme-plugin', verb: pull },
      { plugin: 'acme-plugin', verb: tag },
    ],
    recipeDerivations: () => [],
  };
}

const RECIPE = [
  'recipe weekly',
  '  | The week in tasks.',
  'param team = design',
  '',
  'acme.pull team={team}',
  'acme.tag',
  'where status = done',
  'select key, status',
  '',
].join('\n');

let scratch: string;
let workspace: string;
let recipePath: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-recipe-runner-')));
  workspace = join(scratch, 'promo');
  await mkdir(join(workspace, 'recipes'), { recursive: true });
  recipePath = join(workspace, 'recipes', 'weekly.recipe');
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function harness(
  place: RecipePlace = { trust: 'trusted', folder: '' },
  section: unknown = { site: 'https://acme.example' },
) {
  const calls: Calls = { pull: 0, tag: 0, sections: [] };
  const runner = createRecipeRunner({
    contributions: acme(calls),
    placeOf: () => Promise.resolve(place.folder === '' ? { ...place, folder: workspace } : place),
    sectionFor: (_directory, plugin) => (plugin === 'acme-plugin' ? section : undefined),
    home: join(scratch, 'home'),
    clock: () => clock,
  });
  const run = (text: string, more: Partial<RecipeRunInput> = {}) =>
    runner.run({ documentId: 'tab-1', text, path: recipePath, ...more });
  return { runner, calls, run };
}

const statuses = (answer: { cells: readonly { status: string }[] }) =>
  answer.cells.map((cell) => cell.status);

describe('running a recipe cell by cell', () => {
  it('answers a table per cell, with its line, when it ran and how old its data is', async () => {
    const { run, calls } = harness();

    const answer = await run(RECIPE, { saved: true });

    expect(answer.diagnostics).toEqual([]);
    expect(answer.held).toBeUndefined();
    expect(answer.ranAt).toBe(NOW);
    expect(answer.cells.map((cell) => [cell.index, cell.line, cell.status])).toEqual([
      [0, 5, 'ok'],
      [1, 6, 'ok'],
      [2, 7, 'ok'],
      [3, 8, 'ok'],
    ]);
    expect(answer.cells.map((cell) => cell.table?.rows.length)).toEqual([2, 2, 1, 1]);
    expect(answer.cells[0]?.ranAt).toBe(NOW);
    expect(answer.cells[0]?.oldestFetchedAt).toBe('2026-10-27T08:15:00.000Z');
    expect(calls).toMatchObject({ pull: 1, tag: 1 });
    // Its own plugin's section, asked for this call.
    expect(calls.sections).toEqual([{ site: 'https://acme.example' }]);
  });

  it('reruns from the first changed step, reading the table the cell before it kept', async () => {
    const { run, calls } = harness();
    await run(RECIPE, { saved: true });

    // A pause in typing after editing the fourth line: only it runs.
    const fourth = await run(RECIPE.replace('select key, status', 'select key'));
    expect(statuses(fourth)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(fourth.cells[3]?.table?.columns.map((column) => column.name)).toEqual(['key']);
    expect(calls).toMatchObject({ pull: 1, tag: 1 });

    // The third: it and the fourth run, and nothing before it.
    const third = await run(RECIPE.replace('where status = done', 'where status = open'));
    expect(third.cells[2]?.table?.rows.map((row) => row.key)).toEqual(['T-2']);
    expect(calls).toMatchObject({ pull: 1, tag: 1 });

    // The same text again runs nothing at all.
    await run(RECIPE.replace('where status = done', 'where status = open'));
    expect(calls).toMatchObject({ pull: 1, tag: 1 });
  });

  it('leaves a source stale while typing, and runs it on save or Run', async () => {
    const { run, calls } = harness();
    await run(RECIPE, { saved: true });
    const edited = RECIPE.replace('acme.pull team={team}', 'acme.pull team=print');

    const typing = await run(edited);
    expect(typing.held).toBe('source');
    expect(statuses(typing)).toEqual(['stale', 'stale', 'stale', 'stale']);
    // A stale cell shows the table it had.
    expect(typing.cells[0]?.table?.rows.length).toBe(2);
    expect(calls.pull).toBe(1);

    const saved = await run(edited, { saved: true });
    expect(statuses(saved)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(calls.pull).toBe(2);

    await run(RECIPE);
    const explicit = await run(RECIPE, { explicit: true });
    expect(explicit.held).toBeUndefined();
    expect(calls.pull).toBe(3);
  });

  it('runs the cells before a source while typing, and stops at it', async () => {
    const { run, calls } = harness();
    const later = ['recipe later', 'run first', 'acme.pull', 'acme.tag', ''].join('\n');
    await writeFile(join(workspace, 'recipes', 'first.recipe'), 'recipe first\nacme.tag\n');

    const typing = await run(later);
    // `run first` includes a recipe whose transform has no table to read; it ran, and failed.
    expect(statuses(typing)).toEqual(['failed', 'stale', 'stale']);
    expect(typing.held).toBe('source');
    expect(calls.pull).toBe(0);
  });

  it('reruns every cell when a param line or the header changes', async () => {
    const { run, calls } = harness();
    await run(RECIPE, { saved: true });

    await run(RECIPE.replace('param team = design', 'param team = print'), { saved: true });
    expect(calls).toMatchObject({ pull: 2, tag: 2 });

    await run(RECIPE.replace('recipe weekly', 'recipe monthly'), { saved: true });
    expect(calls).toMatchObject({ pull: 3, tag: 3 });
  });

  it('reruns from a cell on request, and from nothing it kept once asked to start fresh', async () => {
    const { run, calls } = harness();
    await run(RECIPE, { saved: true });

    await run(RECIPE, { from: 1, explicit: true });
    expect(calls).toMatchObject({ pull: 1, tag: 2 });

    await run(RECIPE, { fresh: true, saved: true });
    expect(calls).toMatchObject({ pull: 2, tag: 3 });
  });

  it('forgets a document when its tab closes, and keeps documents apart', async () => {
    const { runner, run, calls } = harness();
    await run(RECIPE, { saved: true });
    await runner.run({ documentId: 'tab-2', text: RECIPE, path: recipePath, saved: true });
    expect(calls.pull).toBe(2);

    runner.close('tab-1');
    await run(RECIPE, { saved: true });
    expect(calls.pull).toBe(3);
    await runner.run({ documentId: 'tab-2', text: RECIPE, path: recipePath, saved: true });
    expect(calls.pull).toBe(3);
  });

  it('answers a syntax error for the whole file, and shows the cells it had as stale', async () => {
    const { run, calls } = harness();
    await run(RECIPE, { saved: true });

    const broken = await run(RECIPE.replace('where status = done', 'where title = "unclosed'));

    expect(broken.diagnostics.map((item) => item.code)).toContain('E_RECIPE_SYNTAX');
    expect(statuses(broken)).toEqual(['stale', 'stale', 'stale', 'stale']);
    expect(broken.cells.map((cell) => cell.table?.rows.length)).toEqual([2, 2, 1, 1]);
    expect(calls).toMatchObject({ pull: 1, tag: 1 });

    // Fixed again: everything it kept still stands, and nothing runs.
    const fixed = await run(RECIPE);
    expect(statuses(fixed)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(calls).toMatchObject({ pull: 1, tag: 1 });
  });

  it('keeps the cells of the latest run when an older one finishes after it', async () => {
    const { run, calls } = harness();
    const text = (status: string) =>
      ['recipe late', 'acme.pull', `where status = ${status}`, 'acme.tag', ''].join('\n');
    let release: () => void = () => undefined;
    calls.gate = new Promise((resolve) => (release = resolve));

    const older = run(text('done'), { saved: true });
    const newer = await run(text('open'), { saved: true });
    release();
    await older;
    expect(newer.cells[1]?.table?.rows.map((row) => row.key)).toEqual(['T-2']);
    expect(calls).toMatchObject({ pull: 2, tag: 2 });

    // The newer run's cells are what is kept: its text again runs nothing.
    await run(text('open'));
    expect(calls).toMatchObject({ pull: 2, tag: 2 });
  });

  it('names the generic verbs and every running plugin verb', () => {
    const { runner } = harness();
    expect(runner.verbs()).toEqual(
      expect.arrayContaining(['where', 'run', 'acme.pull', 'acme.tag']),
    );
  });
});

describe('a restricted folder (ADR 0111, ADR 0148)', () => {
  const RULES = ['recipe ruled', 'acme.pull', 'rules into=kind using=@./rules.json', ''].join('\n');

  beforeEach(async () => {
    await writeFile(
      join(workspace, 'recipes', 'rules.json'),
      '[{ "when": "status = done", "set": { "kind": "finished" } }]',
    );
  });

  it('reads the data files and hands the sections in a trusted folder', async () => {
    const { run, calls } = harness();
    const answer = await run(RULES, { saved: true });
    expect(statuses(answer)).toEqual(['ok', 'ok']);
    expect(answer.cells[1]?.table?.rows[0]?.values['kind']).toBe('finished');
    expect(calls.sections).toEqual([{ site: 'https://acme.example' }]);
  });

  it('runs nothing by itself, and on Run runs with data refused and no section', async () => {
    const { run, calls } = harness({ trust: 'restricted', folder: '' });

    for (const request of [{}, { saved: true }] as const) {
      const held = await run(RULES, request);
      expect(held.held).toBe('restricted');
      expect(statuses(held)).toEqual(['stale', 'stale']);
    }
    expect(calls.pull).toBe(0);

    const explicit = await run(RULES, { explicit: true });
    expect(explicit.held).toBeUndefined();
    expect(calls.pull).toBe(1);
    // A section the folder would offer is withheld all the same.
    expect(calls.sections).toEqual([undefined]);
    expect(statuses(explicit)).toEqual(['ok', 'failed']);
    expect(explicit.cells[1]?.diagnostics.map((item) => item.code)).toEqual([
      'E_RECIPE_DATA_RESTRICTED',
    ]);
  });

  it('outside any workspace runs with no data files and no section', async () => {
    const { run, calls } = harness({ trust: 'none' });
    const answer = await run(RULES, { saved: true });
    expect(calls.sections).toEqual([undefined]);
    expect(statuses(answer)).toEqual(['ok', 'failed']);
    expect(answer.cells[1]?.diagnostics.map((item) => item.code)).toEqual(['E_RECIPE_DATA']);
  });
});

describe('what a run may read beside it', () => {
  it('includes a recipe from its own folder, and from nowhere else', async () => {
    await writeFile(
      join(workspace, 'recipes', 'done.recipe'),
      'recipe done\nwhere status = done\n',
    );
    await writeFile(join(workspace, 'outside.recipe'), 'recipe outside\nwhere status = open\n');
    const { run } = harness();
    const text = (name: string) => ['recipe outer', 'acme.pull', `run ${name}`, ''].join('\n');

    const inside = await run(text('done'), { saved: true });
    expect(statuses(inside)).toEqual(['ok', 'ok']);
    expect(inside.cells[1]?.table?.rows.map((row) => row.key)).toEqual(['T-1']);

    for (const name of ['../outside', 'missing']) {
      const refused = await run(text(name), { saved: true });
      expect(statuses(refused)).toEqual(['ok', 'failed']);
      expect(refused.cells[1]?.diagnostics.map((item) => item.code)).toEqual(['E_RECIPE_RUN']);
    }
  });

  it('binds the state to the workspace and the recipe, and reads it without writing', async () => {
    const asked: unknown[] = [];
    let written = 0;
    const store: RecipeState = {
      read: () =>
        Promise.resolve(ok(new Map([['T-1', { values: { status: 'open' }, storedAt: NOW }]]))),
      entries: () => Promise.resolve(ok(new Map())),
      write: () => {
        written += 1;
        return Promise.resolve(ok(undefined));
      },
    };
    const calls: Calls = { pull: 0, tag: 0, sections: [] };
    const runner = createRecipeRunner({
      contributions: acme(calls),
      placeOf: () => Promise.resolve({ trust: 'restricted', folder: workspace }),
      sectionFor: () => undefined,
      home: join(scratch, 'home'),
      clock: () => clock,
      state: (options) => {
        asked.push(options);
        return store;
      },
    });

    const answer = await runner.run({
      documentId: 'tab-1',
      text: 'recipe synced\nacme.pull\nlast sync\nremember sync columns=status\n',
      path: recipePath,
      explicit: true,
    });

    expect(statuses(answer)).toEqual(['ok', 'ok', 'ok']);
    expect(answer.cells[1]?.table?.rows[0]?.values['last_status']).toBe('open');
    expect(asked).toEqual([{ home: join(scratch, 'home'), workspace, recipe: recipePath }]);
    expect(written).toBe(0);
  });
});

describe('the state a run is handed', () => {
  it('reads through, and refuses every write', async () => {
    let written = 0;
    const store: RecipeState = {
      read: () => Promise.resolve(ok(new Map())),
      entries: () => Promise.resolve(ok(new Map([['k', { values: {}, storedAt: NOW }]]))),
      write: () => {
        written += 1;
        return Promise.resolve(ok(undefined));
      },
    };
    const readOnly = readOnlyState(store);

    expect((await readOnly.entries('sync')).ok).toBe(true);
    const refused = await readOnly.write('sync', [{ key: 'k', values: { a: 1 } }], []);
    expect(refused.ok).toBe(false);
    expect(refused.ok ? [] : refused.error.map((item) => item.code)).toEqual(['E_RECIPE_STATE']);
    expect(written).toBe(0);
  });
});

describe('the age of a table', () => {
  it('is its oldest row, passing over a value that is not a date', () => {
    const rows = [
      ...TASKS.rows,
      { ...TASKS.rows[0]!, provenance: { source: 'x', id: 'y', fetchedAt: 'yesterday' } },
    ];
    expect(oldestFetchedAt({ ...TASKS, rows })).toBe('2026-10-27T08:15:00.000Z');
    expect(oldestFetchedAt({ ...TASKS, rows: [] })).toBeUndefined();
  });
});
