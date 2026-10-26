import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import { column, memoryState, runWithState } from './__fixtures__/state-harness.js';
import type { RunClock } from './clock.js';
import type { RecipeState } from './state.js';
import { stateToCommit } from './state.js';
import type { Table } from './table.js';

const SAO_PAULO = -180;

/** A clock stopped at `now`, in São Paulo's offset unless told otherwise. */
function clockAt(now: string, offset = SAO_PAULO): RunClock {
  return { now: () => new Date(now), offsetMinutes: () => offset };
}

/** 16:17 on 1 October 2026 on a São Paulo wall. */
const DONE_AT = clockAt('2026-10-01T19:17:00Z');
const STAMP = 'stamp done_at when="status = done" format="dd-MM HH:mm"';
const AGE = 'age done_at format="dd-MM HH:mm,dd-MM" year=infer-past into=age month-into=month';

function run(lines: readonly string[], input: Table, clock: RunClock, state?: RecipeState) {
  return runWithState(lines, input, state, {}, { clock });
}

/** Writes what an applied run asked to remember, as the host will (ADR 0140). */
async function apply(state: ReturnType<typeof memoryState>, ran: Awaited<ReturnType<typeof run>>) {
  for (const commit of stateToCommit(ran.run.remembers, { operations: [] })) {
    await state.write(commit.store, commit.puts, commit.deletes);
  }
}

describe('stamp', () => {
  // Buraqueira: test_carimbo_ida_e_volta
  it('writes the wall-clock time, and age reads it back', async () => {
    const ran = await run(
      [STAMP, AGE],
      tasks(
        ['status', 'done_at'],
        [
          ['done', null],
          ['doing', null],
          ['done', '  '],
        ],
      ),
      DONE_AT,
    );
    expect(ran.errors).toEqual([]);
    expect(column(ran.table, 'done_at')).toEqual(['01-10 16:17', null, '01-10 16:17']);
    expect(column(ran.table, 'age')).toEqual([0, null, 0]);
    expect(column(ran.table, 'month')).toEqual(['2026-10', null, '2026-10']);
  });

  it('writes yyyy and pads every field', async () => {
    const ran = await run(
      ['stamp done_at when="status = done" format="yyyy/MM/dd HH:mm"'],
      tasks(['status', 'done_at'], [['done', null]]),
      clockAt('2027-01-02T03:04:00Z', 0),
    );
    expect(column(ran.table, 'done_at')).toEqual(['2027/01/02 03:04']);
  });

  it('keeps a stamp a person typed, never overwriting a cell', async () => {
    const ran = await run(
      [STAMP],
      tasks(
        ['status', 'done_at'],
        [
          ['done', '28-09'],
          ['done', 'yesterday'],
        ],
      ),
      DONE_AT,
    );
    expect(column(ran.table, 'done_at')).toEqual(['28-09', 'yesterday']);
  });

  describe('clears only a stamp the flow wrote (ADR 0140 decision 9)', () => {
    const LINES = [
      'last sync columns=done_at',
      `${STAMP} clear-when="status != done AND last_done_at is not empty"`,
      'remember sync columns=done_at when="status = done"',
      'remember sync columns=done_at when="status != done AND last_done_at is not empty"',
    ];

    it('clears the stamp it remembers writing, and keeps the one a person typed', async () => {
      const state = memoryState();
      const first = await run(
        LINES,
        tasks(
          ['status', 'done_at'],
          [
            ['done', null],
            ['review', '28-09'],
          ],
        ),
        DONE_AT,
        state,
      );
      expect(first.errors).toEqual([]);
      expect(column(first.table, 'done_at')).toEqual(['01-10 16:17', '28-09']);
      await apply(state, first);

      // Both rows are out of done: the flow's stamp goes, the typed one stays.
      const second = await run(
        LINES,
        tasks(
          ['status', 'done_at'],
          [
            ['review', '01-10 16:17'],
            ['review', '28-09'],
          ],
        ),
        clockAt('2026-10-02T12:00:00Z'),
        state,
      );
      expect(second.errors).toEqual([]);
      expect(column(second.table, 'last_done_at')).toEqual(['01-10 16:17', null]);
      expect(column(second.table, 'done_at')).toEqual([null, '28-09']);
      await apply(state, second);

      // The cleared stamp is forgotten too, so a date typed afterwards stays.
      const third = await run(
        LINES,
        tasks(
          ['status', 'done_at'],
          [
            ['review', '02-10'],
            ['review', '28-09'],
          ],
        ),
        clockAt('2026-10-03T12:00:00Z'),
        state,
      );
      expect(column(third.table, 'last_done_at')).toEqual([null, null]);
      expect(column(third.table, 'done_at')).toEqual(['02-10', '28-09']);
    });

    it('does not stamp a row it clears', async () => {
      const ran = await run(
        [`${STAMP} clear-when="status = done"`],
        tasks(['status', 'done_at'], [['done', null]]),
        DONE_AT,
      );
      expect(column(ran.table, 'done_at')).toEqual([null]);
    });
  });

  describe('refuses', () => {
    const TABLE = tasks(['status', 'done_at'], [['done', null]]);
    async function refusal(line: string) {
      const { errors, at } = await run([line], TABLE, DONE_AT);
      return [errors[0]?.code, at];
    }

    it.each([
      ['no when=', 'stamp done_at format="dd-MM"', 'E_RECIPE_ARGUMENTS', 'done_at format="dd-MM"'],
      [
        'no format=',
        'stamp done_at when="status = done"',
        'E_RECIPE_ARGUMENTS',
        'done_at when="status = done"',
      ],
      ['a second column', `${STAMP} age`, 'E_RECIPE_ARGUMENTS', 'age'],
      [
        'an argument given twice',
        `${STAMP} when="status = doing"`,
        'E_RECIPE_ARGUMENTS',
        'when="status = doing"',
      ],
      ['an argument it does not take', `${STAMP} into=x`, 'E_RECIPE_ARGUMENTS', 'into=x'],
      [
        'a letter outside a token',
        'stamp done_at when="status = done" format="dd-MM HH:mm:ss"',
        'E_RECIPE_ARGUMENTS',
        'format="dd-MM HH:mm:ss"',
      ],
      [
        'a column the table lacks',
        'stamp finished when="status = done" format="dd-MM"',
        'E_RECIPE_UNKNOWN_COLUMN',
        'finished',
      ],
      ['a clear-when= it cannot read', `${STAMP} clear-when="status !"`, 'E_RECIPE_WHERE', '!'],
    ])('%s', async (_case, line, code, at) => {
      expect(await refusal(line)).toEqual([code, at]);
    });
  });
});

describe('age month-into=', () => {
  // Buraqueira: mes_de over ler_carimbo, a December stamp read in January.
  it('files a December stamp read in January under the year before', async () => {
    const ran = await run(
      [AGE],
      tasks(['done_at'], [['30-12 09:00'], ['02-01'], [null], ['yesterday']]),
      clockAt('2027-01-02T15:00:00Z'),
    );
    expect(ran.errors).toEqual([]);
    expect(column(ran.table, 'month')).toEqual(['2026-12', '2027-01', null, null]);
    expect(ran.table?.columns.at(-1)).toEqual({ name: 'month', type: 'text', origin: 'age' });
  });

  it('reads the month on the wall clock, not in UTC', async () => {
    // 31-10 22:30 in São Paulo is 1 November in UTC.
    const ran = await run(
      [AGE],
      tasks(['done_at'], [['31-10 22:30']]),
      clockAt('2026-11-02T12:00:00Z'),
    );
    expect(column(ran.table, 'month')).toEqual(['2026-10']);
  });

  it.each([
    [
      'a name that cannot be a column',
      `${AGE.replace('month-into=month', 'month-into=1st')}`,
      'month-into=1st',
    ],
    [
      'the column into= writes',
      `${AGE.replace('month-into=month', 'month-into=AGE')}`,
      'month-into=AGE',
    ],
  ])('refuses %s', async (_case, line, at) => {
    const ran = await run([line], tasks(['done_at'], [['01-10']]), DONE_AT);
    expect([ran.errors[0]?.code, ran.at]).toEqual(['E_RECIPE_ARGUMENTS', at]);
  });
});

/**
 * Buraqueira held a done row 72 hours and then filed it under its stamp's month, but only when
 * the tracker had arrived too (`planejar`): that is `age`, `decide` and a `where`, no verb of
 * its own.
 */
describe('the 72-hour hold is a recipe', () => {
  const LINES = [
    'last sync columns=status',
    AGE,
    'decide status local=sheet remote=tracker last=last_status ' +
      'values=todo,doing,approval,review,done first-run-wins=done',
    'where age >= 72 AND last_status = done AND status_action != push',
  ];
  const ROWS = tasks(
    ['sheet', 'tracker', 'done_at'],
    [
      ['done', 'done', '01-10 16:17'],
      ['done', 'done', '01-10 16:18'],
      ['done', 'doing', '01-10 16:17'],
      ['done', 'done', '01-10 16:17'],
    ],
  );
  const STATE = {
    sync: {
      'T-0': { status: 'done' },
      'T-1': { status: 'done' },
      'T-2': { status: 'doing' },
      'T-3': { status: 'review' },
    },
  };

  // Buraqueira: test_prazo_e_de_72_horas_inclusive and test_72h_vencidas_com_jira_no_feito
  it('lets a row out at exactly 72 hours, into its stamp month', async () => {
    const ran = await run(LINES, ROWS, clockAt('2026-10-04T19:17:00Z'), memoryState(STATE));
    expect(ran.errors).toEqual([]);
    expect(column(ran.table, 'age')).toEqual([72]);
    expect(column(ran.table, 'key')).toEqual(['T-0']);
    expect(column(ran.table, 'month')).toEqual(['2026-10']);
  });

  it('holds every row a minute before', async () => {
    const ran = await run(LINES, ROWS, clockAt('2026-10-04T19:16:00Z'), memoryState(STATE));
    expect(ran.errors).toEqual([]);
    expect(column(ran.table, 'key')).toEqual([]);
  });
});
