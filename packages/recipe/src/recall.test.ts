import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import {
  STORED_AT,
  column,
  memoryState,
  runWithState as run,
} from './__fixtures__/state-harness.js';
import type { RunClock } from './clock.js';
import { stateToCommit } from './state.js';
import type { Table } from './table.js';

/** Two parents in the table today; the store remembers one of them and two that are not. */
const PARENTS = tasks(
  ['parent', 'decision'],
  [
    ['P-1', 'wait art'],
    ['P-2', 'release'],
  ],
);

const keys = (table: Table | undefined) => table?.rows.map((row) => row.key) ?? [];

describe("the harness's entries", () => {
  it('lists what a store holds after a write, and an unwritten store as empty', async () => {
    const state = memoryState();
    await state.write('waiting', [{ key: 'P-1', values: { since: 'x' } }], []);
    const all = await state.entries('waiting');
    expect(all.ok ? Object.fromEntries(all.value) : all.error).toEqual({
      'P-1': { values: { since: 'x' }, storedAt: STORED_AT },
    });
    const none = await state.entries('other');
    expect(none.ok ? [...none.value] : none.error).toEqual([]);
  });
});

describe('recall', () => {
  it('appends a row for each stored key the table lacks, after its rows, in key order', async () => {
    const state = memoryState({
      waiting: { 'T-9': { since: 'a' }, 'T-0': { since: 'b' }, 'T-5': { since: 'c' } },
    });
    const { table, errors } = await run(['recall waiting'], PARENTS, state);
    expect(errors).toEqual([]);
    expect(keys(table)).toEqual(['T-0', 'T-1', 'T-5', 'T-9']);
    expect(table?.columns).toEqual(PARENTS.columns);
    expect(table?.rows[2]).toEqual({
      key: 'T-5',
      values: { key: null, parent: null, decision: null },
      provenance: { source: 'recall waiting', id: 'T-5', fetchedAt: STORED_AT },
    });
  });

  it('matches on the by= column, which the recalled row carries', async () => {
    const state = memoryState({ waiting: { 'P-1': {}, 'P-7': {}, 'P-3': {} } });
    const { table, errors } = await run(['recall waiting by=parent'], PARENTS, state);
    expect(errors).toEqual([]);
    expect(keys(table)).toEqual(['T-0', 'T-1', 'P-3', 'P-7']);
    expect(column(table, 'parent')).toEqual(['P-1', 'P-2', 'P-3', 'P-7']);
    expect(column(table, 'decision')).toEqual(['wait art', 'release', null, null]);
  });

  it('adds a boolean mark= column, true on the recalled rows only', async () => {
    const state = memoryState({ waiting: { 'T-7': {} } });
    const { table } = await run(['recall waiting mark=recalled'], PARENTS, state);
    expect(table?.columns.at(-1)).toEqual({
      name: 'recalled',
      type: 'boolean',
      origin: 'recall waiting',
    });
    expect(column(table, 'recalled')).toEqual([false, false, true]);
  });

  it('adds nothing, and no mark column without mark=, when every key is present', async () => {
    const state = memoryState({ waiting: { 'T-0': {}, 'T-1': {} } });
    const { table, errors } = await run(['recall waiting'], PARENTS, state);
    expect(errors).toEqual([]);
    expect(table).toEqual(PARENTS);
  });

  it('refuses a recalled key that is already the key of a row with another by= value', async () => {
    const state = memoryState({ waiting: { 'T-1': {} } });
    const { table, errors, at } = await run(['recall waiting by=parent'], PARENTS, state);
    expect(table).toBeUndefined();
    expect(errors.map(({ code }) => code)).toEqual(['E_RECIPE_ARGUMENTS']);
    expect(errors[0]?.message).toContain("would recall 'T-1'");
    expect(at).toBe('by=parent');
  });

  it('refuses a mark= column the table already has', async () => {
    const { errors, at } = await run(
      ['recall waiting mark=decision'],
      PARENTS,
      memoryState({ waiting: { 'T-7': {} } }),
    );
    expect(errors.map(({ code }) => code)).toEqual(['E_RECIPE_ARGUMENTS']);
    expect(at).toBe('mark=decision');
  });

  it('fails without a store, rather than recalling nothing', async () => {
    const { table, errors, at } = await run(['recall waiting'], PARENTS, undefined);
    expect(table).toBeUndefined();
    expect(errors.map(({ code }) => code)).toEqual(['E_RECIPE_STATE']);
    expect(at).toBe('recall');
  });

  it('leaves the recalled rows to last, which fills their last_ columns', async () => {
    const state = memoryState({
      waiting: { 'P-1': { since: '2026-10-01 09:00' }, 'P-3': { since: '2026-09-20 10:00' } },
    });
    const { table, errors } = await run(
      ['recall waiting by=parent', 'last waiting by=parent columns=since'],
      PARENTS,
      state,
    );
    expect(errors).toEqual([]);
    expect(column(table, 'parent')).toEqual(['P-1', 'P-2', 'P-3']);
    expect(column(table, 'last_since')).toEqual(['2026-10-01 09:00', null, '2026-09-20 10:00']);
    expect(column(table, 'last_stored_at')).toEqual([STORED_AT, null, STORED_AT]);
  });
});

/**
 * Expiry is a recipe, not a mechanism (ADR 0144): `since` is stamped the first time a parent
 * waits and carried over from the store after that, because `storedAt` is re-stamped on every
 * write and cannot say since when. A parent that waited more than 720 hours (Buraqueira's 30
 * days) is forgotten; one that stops waiting is forgotten at once.
 */
const EXPIRY = [
  'recall waiting by=parent',
  'last waiting by=parent columns=since',
  'compose since="{last_since|}"',
  'stamp since when="decision ~ wait" format="yyyy-MM-dd HH:mm"',
  'age since format="yyyy-MM-dd HH:mm" into=waited',
  'rules into=still_waiting using=[{"when": "decision ~ wait AND waited <= 720", ' +
    '"set": {"still_waiting": "yes"}}]',
  'remember waiting by=parent columns=since,decision when="still_waiting = yes" ' +
    'forget-when="still_waiting != yes"',
];

const UTC: RunClock['offsetMinutes'] = () => 0;
const START = Date.parse('2026-10-01T09:00:00Z');
const HOUR = 3_600_000;

/** A clock `hours` after the first run. */
function after(hours: number): RunClock {
  return { now: () => new Date(START + hours * HOUR), offsetMinutes: UTC };
}

/** One applied run of the recipe over the table, at `hours` after the first. */
async function applied(
  lines: readonly string[],
  state: ReturnType<typeof memoryState>,
  input: Table,
  hours: number,
) {
  const ran = await run(lines, input, state, {}, { clock: after(hours) });
  expect(ran.errors).toEqual([]);
  for (const commit of stateToCommit(ran.run.remembers, { operations: [] })) {
    await state.write(commit.store, commit.puts, commit.deletes);
  }
  return ran;
}

const waiting = (state: ReturnType<typeof memoryState>) =>
  Object.fromEntries(
    [...(state.stores.get('waiting') ?? new Map())].map(([key, entry]) => [key, entry.values]),
  );

describe('the expiry pattern', () => {
  const WAITS = tasks(['parent', 'decision'], [['P-1', 'wait art']]);

  it('measures from the first wait: kept at exactly 720 hours, forgotten at 721', async () => {
    const state = memoryState();
    await applied(EXPIRY, state, WAITS, 0);
    expect(waiting(state)).toEqual({
      'P-1': { since: '2026-10-01 09:00', decision: 'wait art' },
    });

    const kept = await applied(EXPIRY, state, WAITS, 720);
    expect(column(kept.table, 'waited')).toEqual([720]);
    expect(waiting(state)).toEqual({
      'P-1': { since: '2026-10-01 09:00', decision: 'wait art' },
    });

    const expired = await applied(EXPIRY, state, WAITS, 721);
    expect(column(expired.table, 'waited')).toEqual([721]);
    expect(waiting(state)).toEqual({});
  });

  it('forgets a parent once it stops waiting, and starts the count over if it waits again', async () => {
    const state = memoryState();
    await applied(EXPIRY, state, WAITS, 0);
    await applied(EXPIRY, state, tasks(['parent', 'decision'], [['P-1', 'release']]), 24);
    expect(waiting(state)).toEqual({});

    await applied(EXPIRY, state, WAITS, 48);
    expect(waiting(state)).toEqual({
      'P-1': { since: '2026-10-03 09:00', decision: 'wait art' },
    });
  });

  it('brings back a parent the source did not fetch, carrying when it first waited', async () => {
    const state = memoryState();
    await applied(EXPIRY, state, WAITS, 0);
    const other = tasks(['parent', 'decision'], [['P-2', 'release']]);
    const recalled = await run(EXPIRY.slice(0, 3), other, state, {}, { clock: after(10) });
    expect(recalled.errors).toEqual([]);
    expect(column(recalled.table, 'parent')).toEqual(['P-2', 'P-1']);
    expect(column(recalled.table, 'since')).toEqual([null, '2026-10-01 09:00']);
  });
});
