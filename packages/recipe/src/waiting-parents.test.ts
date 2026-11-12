import { ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import { EXPIRY, PARENT_RULES } from './__fixtures__/parents.js';
import { column, memoryState, runWithState as run } from './__fixtures__/state-harness.js';
import type { RunClock } from './clock.js';
import type { Verb } from './registry.js';
import { type ApplyOutcome, stateToCommit } from './state.js';
import type { CellValue, Table } from './table.js';

/**
 * Buraqueira's waiting parents (`tests/test_pai.py`, `processar_pais`), ported as runs of one
 * recipe over a store between them. A finished artwork task that reached the tracker sends its
 * parent through the parent rules; a parent that must wait for its animation is remembered, and
 * every later run recalls it, re-fetches it and decides again until it moves or expires.
 *
 * The recipe does not move the parent: acting is the plugin's job (TYTO-378). What it would do
 * is the `move` column, the walk from the parent's status to its target.
 */

type Child = readonly [kind: string, ready: boolean];

interface Parent {
  status: string;
  description: string;
  children: Child[];
}

/** The tracker the parents live in, which a test changes between two runs. */
type Tracker = Record<string, Parent>;

const count = (parent: Parent, kind: string, open: boolean) =>
  parent.children.filter(([each, ready]) => each === kind && (!open || !ready)).length;

/**
 * Stands in for the tracker plugin's transform that re-fetches each row's parent by key
 * (TYTO-386, not built): the parent's status and description, and the three counts the parent
 * rules read.
 */
function refetch(tracker: Tracker): Verb {
  const added = [
    ['parent_status', 'text'],
    ['description', 'text'],
    ['open_artwork', 'number'],
    ['posting', 'number'],
    ['open_animation', 'number'],
  ] as const;
  return {
    kind: 'transform',
    run: ({ table }) => {
      const input = table ?? { columns: [], rows: [] };
      const fetched: Table = {
        columns: [
          ...input.columns,
          ...added.map(([name, type]) => ({ name, type, origin: 'test.refetch' })),
        ],
        rows: input.rows.map((row) => {
          const parent = tracker[String(row.values.parent)];
          const values: Record<string, CellValue> = {
            parent_status: parent?.status ?? null,
            description: parent?.description ?? null,
            open_artwork: parent === undefined ? null : count(parent, 'artwork', true),
            posting: parent === undefined ? null : count(parent, 'posting', false),
            open_animation: parent === undefined ? null : count(parent, 'animation', true),
          };
          return { ...row, values: { ...row.values, ...values } };
        }),
      };
      return ok({ table: fetched });
    },
  };
}

const FILES = {
  './parents.json': {
    decision: PARENT_RULES,
    target: { post: 'to-post', conclude: 'concluded' },
    graph: {
      queue: ['cancelled', 'doing'],
      doing: ['to-post', 'concluded'],
      'to-post': ['concluded'],
    },
    avoid: ['cancelled'],
  },
};

/**
 * Stands in for the tracker plugin's sink that pushes each artwork task (TYTO-386, not built): one
 * `push` per row, which a test's apply outcome then applies or fails.
 */
const push: Verb = {
  kind: 'sink',
  run: ({ table }) => {
    const input = table ?? { columns: [], rows: [] };
    const operations = input.rows.map((row) => ({
      write: 'push',
      rowKey: row.key,
      description: `Push ${row.key}`,
    }));
    return ok({ table: input, plan: { target: 'tracker', operations, count: operations.length } });
  },
};

/**
 * Pushes the artwork tasks of `input` in a run of their own and commits it as the host would
 * after Apply (ADR 0170): an applied push stamps the row's `applied_at`, a failed one leaves the
 * row as it was. Buraqueira read "did it reach the tracker?" from the same run; a recipe reads it
 * from the last applied one.
 */
async function pushArtwork(
  state: ReturnType<typeof memoryState>,
  input: Table,
  result: 'applied' | 'failed',
) {
  const ran = await run(
    ['test.push', 'remember pushed columns=status'],
    input,
    state,
    {},
    { verbs: { 'test.push': push } },
  );
  expect(ran.errors).toEqual([]);
  const plan = ran.run.cells[0]?.plan;
  const outcome: ApplyOutcome = {
    operations: (plan?.operations ?? []).map(({ rowKey = '' }) =>
      result === 'applied'
        ? { rowKey, status: 'applied', appliedAt: '2026-09-30T18:00:00.000Z' }
        : { rowKey, status: 'failed', reason: 'the tracker refused it' },
    ),
  };
  for (const commit of stateToCommit(ran.run.remembers, outcome)) {
    await state.write(commit.store, commit.puts, commit.deletes);
  }
}

/** Buraqueira's `avisar` when a design it had sent comes back: the person moves the parent. */
const REOPENED_WARNING =
  'warn when="last_status = done AND status != done" ' +
  'message="{key|} was reopened; its parent {parent|} does not move back on its own"';

/** The run report's line for a parent that waited too long, which the table alone loses. */
const EXPIRED_WARNING =
  'warn when="still_waiting = expired" ' +
  'message="{parent|} waited {waited|} hours for its animation and is no longer waited for"';

const WAITING_PARENTS = [
  'last pushed columns=status,applied_at',
  REOPENED_WARNING,
  'where status = done AND last_applied_at is not empty',
  // EXPIRY's own `last` adds `last_stored_at` again.
  'select without=last_status,last_applied_at,last_stored_at',
  'recall waiting by=parent mark=recalled',
  'test.refetch',
  'rules into=decision using=@./parents.json#/decision',
  'where parent_status not in (to-post, concluded)',
  'map decision using=@./parents.json#/target into=target',
  'path from=parent_status to=target graph=@./parents.json#/graph avoid=@./parents.json#/avoid into=move',
  ...EXPIRY.slice(1),
  EXPIRED_WARNING,
];

/** The artwork task `T-0` in `status`, under the parent `P-100`. */
function artwork(status: string): Table {
  return tasks(['status', 'parent'], [[status, 'P-100']]);
}

/** The sheet once the artwork task has left it. */
const EMPTY_SHEET = tasks(['status', 'parent'], []);

const START = Date.parse('2026-10-01T09:00:00Z');
const HOUR = 3_600_000;

function after(hours: number): RunClock {
  return { now: () => new Date(START + hours * HOUR), offsetMinutes: () => 0 };
}

/**
 * One run at `hours` after the first, committing what it remembers as an applied plan would, or
 * nothing at all when `dryRun` stands for a run whose plan was never applied. The input's
 * artwork tasks were pushed before it, and that push `applied` or `failed`; `skipped` stands for
 * a run that reads what an earlier run pushed before it pushes again.
 */
async function runOnce(
  state: ReturnType<typeof memoryState>,
  tracker: Tracker,
  input: Table,
  options: Parameters<typeof runReported>[3] = {},
) {
  return (await runReported(state, tracker, input, options)).table;
}

/** `runOnce`, answering the warnings the run reported beside its table. */
async function runReported(
  state: ReturnType<typeof memoryState>,
  tracker: Tracker,
  input: Table,
  {
    hours = 0,
    dryRun = false,
    lines = WAITING_PARENTS,
    pushed = 'applied' as 'applied' | 'failed' | 'skipped',
  } = {},
) {
  if (pushed !== 'skipped') await pushArtwork(state, input, pushed);
  const ran = await run(
    lines,
    input,
    state,
    {},
    { clock: after(hours), files: FILES, verbs: { 'test.refetch': refetch(tracker) } },
  );
  expect(ran.errors).toEqual([]);
  const outcome = dryRun ? undefined : { operations: [] };
  for (const commit of stateToCommit(ran.run.remembers, outcome)) {
    await state.write(commit.store, commit.puts, commit.deletes);
  }
  const warnings = ran.run.cells
    .flatMap((cell) => cell.diagnostics)
    .filter(({ code }) => code === 'W_RECIPE_WARN')
    .map(({ message }) => message);
  return { table: ran.table, warnings };
}

const stored = (state: ReturnType<typeof memoryState>, store: string) =>
  Object.fromEntries(
    [...(state.stores.get(store) ?? new Map())].map(([key, entry]) => [key, entry.values]),
  );

/** A parent in `status` with a ready artwork, a posting, and an animation `ready` or not. */
function parentWithAnimation(status: string, ready: boolean): Tracker {
  return {
    'P-100': {
      status,
      description: '',
      children: [
        ['artwork', true],
        ['posting', true],
        ['animation', ready],
      ],
    },
  };
}

describe('waiting parents, ported from processar_pais', () => {
  it('motion_aberta_entra_na_espera_e_sai_quando_conclui', async () => {
    const state = memoryState();
    const tracker = parentWithAnimation('doing', false);

    const first = await runOnce(state, tracker, artwork('done'));
    expect(column(first, 'decision')).toEqual(['wait-animation']);
    expect(column(first, 'move')).toEqual([null]);
    expect(stored(state, 'pushed')).toEqual({
      'T-0': { status: 'done', applied_at: '2026-09-30T18:00:00.000Z' },
    });
    expect(stored(state, 'waiting')).toEqual({
      'P-100': { since: '2026-10-01 09:00', decision: 'wait-animation' },
    });

    // The next run: the artwork task has left the sheet, and the animation is ready.
    tracker['P-100']?.children.splice(2, 1, ['animation', true]);
    const second = await runOnce(state, tracker, EMPTY_SHEET, { hours: 24 });
    expect(column(second, 'parent')).toEqual(['P-100']);
    expect(column(second, 'recalled')).toEqual([true]);
    expect(column(second, 'move')).toEqual([['to-post']]);
    expect(stored(state, 'waiting')).toEqual({});
  });

  it('espera_vence_em_30_dias: a parent that waited past 720 hours is reported and forgotten', async () => {
    const state = memoryState({
      waiting: { 'P-100': { since: '2026-09-01 08:00', decision: 'wait-animation' } },
    });
    const { table, warnings } = await runReported(
      state,
      parentWithAnimation('doing', false),
      EMPTY_SHEET,
    );
    expect(warnings).toEqual([
      "Row 'P-100': P-100 waited 721 hours for its animation and is no longer waited for",
    ]);
    expect(column(table, 'waited')).toEqual([721]);
    expect(column(table, 'still_waiting')).toEqual(['expired']);
    expect(column(table, 'move')).toEqual([null]);
    expect(stored(state, 'waiting')).toEqual({});
  });

  it('pai_que_ja_andou_nao_volta: a parent already concluded is left alone', async () => {
    const state = memoryState();
    const table = await runOnce(state, parentWithAnimation('concluded', true), artwork('done'));
    expect(column(table, 'key')).toEqual([]);
    expect(stored(state, 'waiting')).toEqual({});
  });

  it('design_que_ainda_nao_chegou_nao_move_a_pai: an artwork the tracker lacks moves nothing', async () => {
    const state = memoryState();
    const table = await runOnce(state, parentWithAnimation('doing', true), artwork('done'), {
      pushed: 'failed',
    });
    expect(stored(state, 'pushed')).toEqual({});
    expect(column(table, 'key')).toEqual([]);
    expect(stored(state, 'waiting')).toEqual({});
  });

  it('design_reaberto_avisa_e_nao_mexe_na_pai: a reopened artwork does not move its parent', async () => {
    // Buraqueira's parent sat in to-post, which the already-moved `where` holds on its own; in
    // doing, only the artwork's status keeps a parent that would post from moving.
    for (const status of ['to-post', 'doing']) {
      const state = memoryState();
      const table = await runOnce(state, parentWithAnimation(status, true), artwork('review'));
      expect(column(table, 'key')).toEqual([]);
      expect(stored(state, 'waiting')).toEqual({});
    }
  });

  it('design_reaberto_avisa: a reopened artwork warns that its parent does not move back', async () => {
    // The artwork reached the tracker done in an earlier run, and is back in review now.
    const state = memoryState({
      pushed: { 'T-0': { status: 'done', applied_at: '2026-09-30T18:00:00.000Z' } },
    });
    const { table, warnings } = await runReported(
      state,
      parentWithAnimation('to-post', true),
      artwork('review'),
      { pushed: 'skipped' },
    );
    expect(warnings).toEqual([
      "Row 'T-0': T-0 was reopened; its parent P-100 does not move back on its own",
    ]);
    // The warning outlives the where that drops the row: the table is empty.
    expect(column(table, 'key')).toEqual([]);
    expect(stored(state, 'waiting')).toEqual({});
  });

  it('design_reaberto_avisa: an artwork still done, or never pushed, warns of nothing', async () => {
    const state = memoryState({
      pushed: { 'T-0': { status: 'done', applied_at: '2026-09-30T18:00:00.000Z' } },
    });
    const still = await runReported(state, parentWithAnimation('doing', false), artwork('done'), {
      pushed: 'skipped',
    });
    expect(still.warnings).toEqual([]);
    const never = await runReported(
      memoryState(),
      parentWithAnimation('doing', true),
      artwork('review'),
    );
    expect(never.warnings).toEqual([]);
  });

  it('estado_guarda_as_pais_esperando: the waiting parents live in a store of their own', async () => {
    const state = memoryState();
    await runOnce(state, parentWithAnimation('doing', false), artwork('done'), {
      lines: [...WAITING_PARENTS, 'remember rows columns=status when="status = done"'],
    });
    expect(stored(state, 'rows')).toEqual({ 'T-0': { status: 'done' } });
    expect(stored(state, 'waiting')).toEqual({
      'P-100': { since: '2026-10-01 09:00', decision: 'wait-animation' },
    });
  });

  it('dry_run_so_preve: a run never applied predicts the walk and stores nothing', async () => {
    const state = memoryState();
    const table = await runOnce(state, parentWithAnimation('queue', true), artwork('done'), {
      dryRun: true,
    });
    expect(column(table, 'move')).toEqual([['doing', 'to-post']]);
    expect([...state.stores.keys()]).toEqual(['pushed']);
  });
});
