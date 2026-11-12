import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import { columnOf, runOverShop } from './__fixtures__/rules-harness.js';
import { column, memoryState, runWithState } from './__fixtures__/state-harness.js';
import { type DecideRules, type DecideTie, type Decision, decideValue } from './decide.js';
import { stateToCommit } from './state.js';
import { type CellValue, comparable } from './table.js';

/** The sheet's five statuses, as in `__fixtures__/flows.ts`; done wins a first run. */
const STATUSES = ['todo', 'doing', 'approval', 'review', 'done'];
const STATUS: DecideRules = {
  isValid: (folded) => STATUSES.includes(folded),
  firstRunWins: 'done',
};
/** An owner's rules, as `decidir_responsavel` had them: any name, and no first-run winner. */
const OWNER: DecideRules = { isValid: () => true };

function decided(
  local: CellValue,
  remote: CellValue,
  last: CellValue,
  rules: DecideRules = STATUS,
): Pick<Decision, 'action' | 'value' | 'overrides'> {
  const { action, value, overrides } = decideValue({ local, remote, last }, rules);
  return { action, value, overrides };
}

const push = (value: CellValue, overrides = false) => ({ action: 'push', value, overrides });
const pull = (value: CellValue) => ({ action: 'pull', value, overrides: false });
const same = (value: CellValue) => ({ action: 'same', value, overrides: false });

/** Buraqueira's `tests/test_status.py`, in the neutral statuses. */
describe('decideValue, ported from decidir', () => {
  it('first run: a local done wins', () => {
    expect(decided('done', 'todo', null)).toEqual(push('done'));
  });

  it('first run: does not reopen what the remote side finished', () => {
    expect(decided('todo', 'done', null)).toEqual(pull('done'));
  });

  it('first run: only done wins', () => {
    expect(decided('todo', 'doing', null).action).toBe('pull');
    expect(decided('review', null, null).action).toBe('same');
  });

  it('first run: agreeing is same', () => {
    expect(decided('todo', 'todo', null)).toEqual(same('todo'));
  });

  it('first run: a value out of the list pulls', () => {
    expect(decided('Completed', 'done', null)).toEqual(pull('done'));
  });

  it('only the local side changed: pushes', () => {
    expect(decided('done', 'doing', 'doing')).toEqual(push('done', false));
  });

  it('only the remote side changed: pulls', () => {
    expect(decided('doing', 'approval', 'doing')).toEqual(pull('approval'));
  });

  it('both changed: the local side wins and overrides', () => {
    expect(decided('done', 'approval', 'doing')).toEqual(push('done', true));
  });

  it('a value out of the list returns to the remote one', () => {
    expect(decided('Completed', 'done', 'done')).toEqual(pull('done'));
  });

  it('both already agree', () => {
    expect(decided('done', 'done', 'doing').action).toBe('same');
  });

  it('a remote intermediate status with a local change pushes', () => {
    expect(decided('done', null, 'doing').action).toBe('push');
  });

  it('a value out of the list with no remote value returns to the last one', () => {
    expect(decided('Completed', null, 'review')).toEqual(pull('review'));
  });

  it('nothing changed is same, and every decision names its rule', () => {
    const decision = decideValue({ local: 'doing', remote: 'doing', last: 'doing' }, STATUS);
    expect(decision).toEqual({ ...same('doing'), overwritten: null, reason: 'nothing changed' });
    expect(decideValue({ local: 'done', remote: 'approval', last: 'doing' }, STATUS).reason).toBe(
      'both changed, local wins',
    );
  });
});

/** Buraqueira's `tests/test_responsavel.py`: no first-run winner, the remote side fills. */
describe('decideValue without first-run-wins, ported from decidir_responsavel', () => {
  it('first run: the remote side fills, whatever the local value', () => {
    expect(decided(null, 'ana', null, OWNER)).toEqual(pull('ana'));
    expect(decided('bia', 'ana', null, OWNER)).toEqual(pull('ana'));
  });

  it('an empty local value never clears the remote one: the remote side fills', () => {
    expect(decided(null, 'ana', 'ana', OWNER)).toEqual(pull('ana'));
    expect(decided(null, 'caio', 'ana', OWNER)).toEqual(pull('caio'));
  });

  it('the local side changed: pushes', () => {
    expect(decided('bia', 'caio', 'caio', OWNER)).toEqual(push('bia', false));
  });

  it('both changed: the local side wins and overrides', () => {
    expect(decided('bia', 'ana', 'caio', OWNER)).toEqual(push('bia', true));
  });

  it('only the remote side changed: pulls', () => {
    expect(decided('caio', 'ana', 'caio', OWNER).action).toBe('pull');
  });

  it('an empty remote value is intermediate here too, so an empty local value keeps the last', () => {
    // Buraqueira pulled '' (unassigned) here; a recipe maps "unassigned" to a value instead.
    expect(decided(null, null, 'ana', OWNER)).toEqual(pull('ana'));
  });
});

/** TYTO-421: each case of a shared field under both tie rules. */
describe.each<DecideTie>(['local', 'remote'])('decideValue with tie=%s', (tie) => {
  const rules: DecideRules = { ...STATUS, tie };
  const full = (local: CellValue, remote: CellValue, last: CellValue) => {
    const { action, value, overrides, overwritten } = decideValue({ local, remote, last }, rules);
    return { action, value, overrides, overwritten };
  };

  it('only the sheet changed: pushes, overwriting nothing', () => {
    expect(full('done', 'doing', 'doing')).toEqual({ ...push('done'), overwritten: null });
  });

  it('only the tracker changed: pulls, overwriting nothing', () => {
    expect(full('doing', 'approval', 'doing')).toEqual({ ...pull('approval'), overwritten: null });
  });

  it('both changed: the tie side wins and the losing value is reported', () => {
    expect(full('done', 'Approval', 'doing')).toEqual(
      tie === 'local'
        ? { action: 'push', value: 'done', overrides: true, overwritten: 'Approval' }
        : { action: 'pull', value: 'Approval', overrides: true, overwritten: 'done' },
    );
    expect(decideValue({ local: 'done', remote: 'approval', last: 'doing' }, rules).reason).toBe(
      `both changed, ${tie} wins`,
    );
  });

  it('nothing changed: same', () => {
    expect(full('doing', 'doing', 'doing')).toEqual({ ...same('doing'), overwritten: null });
  });

  it('no state: the first-run rule decides, whatever the tie', () => {
    expect(full('done', 'todo', null)).toEqual({ ...push('done'), overwritten: null });
    expect(full('todo', 'doing', null)).toEqual({ ...pull('doing'), overwritten: null });
  });
});

it('decideValue lets the local side win a tie when no tie is given', () => {
  const decision = decideValue({ local: 'done', remote: 'approval', last: 'doing' }, STATUS);
  expect([decision.action, decision.overwritten]).toEqual(['push', 'approval']);
});

describe('decideValue folds accents, case and blanks', () => {
  it('compares the three sides folded', () => {
    expect(decided(' Dóne', 'DONE', 'doing')).toEqual(same(' Dóne'));
    expect(decided('done', 'approval', 'DONE')).toEqual(pull('approval'));
  });

  it('recognises a listed value folded, and writes each side as it spells it', () => {
    expect(decided('Appróval', 'doing', 'doing')).toEqual(push('Appróval'));
    expect(decided('todo', 'Done', 'todo')).toEqual(pull('Done'));
    expect(comparable('Appróval')).toBe('approval');
  });
});

const VALUES = 'values=todo,doing,approval,review,done';
const DECIDE = `decide status local=sheet remote=tracker last=last_status ${VALUES}`;
const SYNC = tasks(
  ['sheet', 'tracker', 'last_status', 'found'],
  [
    ['done', 'todo', null, 'T-0'],
    ['todo', 'done', null, 'T-1'],
    ['done', null, 'doing', ''],
    ['done', 'approval', 'doing', 'T-3'],
    ['Completed', 'done', 'done', 'T-4'],
  ],
);

function run(lines: readonly string[], files: Record<string, unknown> = {}) {
  return runOverShop(lines, files, SYNC);
}

describe('decide', () => {
  it('writes the decided value, the action, whether it overrides and why', async () => {
    const { table, problem } = await run([`${DECIDE} first-run-wins=done`]);
    expect(problem).toBeUndefined();
    expect(table?.columns.slice(-7).map(({ name, type }) => [name, type])).toEqual([
      ['status', 'text'],
      ['status_action', 'text'],
      ['status_push', 'text'],
      ['status_pushes', 'boolean'],
      ['status_overrides', 'boolean'],
      ['status_overwritten', 'text'],
      ['status_reason', 'text'],
    ]);
    expect(Object.values(columnOf(table, 'status'))).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
    ]);
    expect(Object.values(columnOf(table, 'status_action'))).toEqual([
      'push',
      'pull',
      'push',
      'push',
      'pull',
    ]);
    expect(Object.values(columnOf(table, 'status_overrides'))).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(columnOf(table, 'status_reason')['T-0']).toBe('no state, local first-run value wins');
  });

  it('holds a push where hold-when-empty is empty, keeping the local value', async () => {
    const { table } = await run([`${DECIDE} first-run-wins=done hold-when-empty=found`]);
    expect(Object.values(columnOf(table, 'status_action'))).toEqual([
      'push',
      'pull',
      'hold',
      'push',
      'pull',
    ]);
    expect(columnOf(table, 'status')['T-2']).toBe('done');
    expect(columnOf(table, 'status_overrides')['T-2']).toBe(false);
    expect(columnOf(table, 'status_reason')['T-2']).toBe('remote did not return the row');
  });

  it('lets the remote side fill a first run without first-run-wins', async () => {
    const { table } = await run([DECIDE]);
    expect(columnOf(table, 'status_action')['T-0']).toBe('pull');
    expect(columnOf(table, 'status')['T-0']).toBe('todo');
  });

  it('recognises every non-empty local value without values=', async () => {
    const { table } = await run(['decide status local=sheet remote=tracker last=last_status']);
    expect(columnOf(table, 'status_action')['T-4']).toBe('push');
  });

  it('reads values= from a data file', async () => {
    const files = { './flows.json': { statuses: STATUSES } };
    const { table, problem } = await run(
      [
        'decide status local=sheet remote=tracker last=last_status ' +
          'values=@./flows.json#/statuses first-run-wins=done',
      ],
      files,
    );
    expect(problem).toBeUndefined();
    expect(columnOf(table, 'status_action')['T-4']).toBe('pull');
  });

  describe.each<DecideTie>(['local', 'remote'])('with tie=%s', (tie) => {
    const line = `${DECIDE} first-run-wins=done hold-when-empty=found tie=${tie}`;

    it('writes _push on push rows only, and _overwritten where both changed', async () => {
      const { table, problem } = await run([line]);
      expect(problem).toBeUndefined();
      // T-0 no state, a first-run push; T-1 no state, a pull; T-2 held; T-3 both changed;
      // T-4 a value out of the list.
      expect(Object.values(columnOf(table, 'status_action'))).toEqual([
        'push',
        'pull',
        'hold',
        tie === 'local' ? 'push' : 'pull',
        'pull',
      ]);
      expect(Object.values(columnOf(table, 'status_push'))).toEqual([
        'done',
        null,
        null,
        tie === 'local' ? 'done' : null,
        null,
      ]);
      expect(Object.values(columnOf(table, 'status_pushes'))).toEqual([
        true,
        false,
        false,
        tie === 'local',
        false,
      ]);
      expect(Object.values(columnOf(table, 'status_overrides'))).toEqual([
        false,
        false,
        false,
        true,
        false,
      ]);
      expect(Object.values(columnOf(table, 'status_overwritten'))).toEqual([
        null,
        null,
        null,
        tie === 'local' ? 'approval' : 'done',
        null,
      ]);
      expect(columnOf(table, 'status')['T-3']).toBe(tie === 'local' ? 'done' : 'approval');
    });

    it('rewrites the local= column in place when the name is that column', async () => {
      const shared = tasks(
        ['tracker', 'Status', 'last_status'],
        [
          ['doing', 'done', 'doing'],
          ['approval', 'doing', 'doing'],
          ['approval', 'done', 'doing'],
          ['doing', 'doing', 'doing'],
        ],
      );
      const { table, problem } = await runOverShop(
        [`decide status local=Status remote=tracker last=last_status ${VALUES} tie=${tie}`],
        {},
        shared,
      );
      expect(problem).toBeUndefined();
      expect(table?.columns.map(({ name }) => name)).toEqual([
        'key',
        'tracker',
        'Status',
        'last_status',
        'status_action',
        'status_push',
        'status_pushes',
        'status_overrides',
        'status_overwritten',
        'status_reason',
      ]);
      expect(Object.values(columnOf(table, 'Status'))).toEqual([
        'done',
        'approval',
        tie === 'local' ? 'done' : 'approval',
        'doing',
      ]);
      expect(Object.values(columnOf(table, 'status_push'))).toEqual([
        'done',
        null,
        tie === 'local' ? 'done' : null,
        null,
      ]);
    });
  });

  it('writes _pushes true on every push row and false on every other action', async () => {
    // TYTO-647: an owner, any name recognised and no first-run winner. One row per action:
    // T-0 pushes, T-1 pulls, T-2 is the same, T-3 holds, T-4 had its owner cleared.
    const owners = tasks(
      ['sheet', 'tracker', 'last_owner', 'found'],
      [
        ['bia', 'caio', 'caio', 'T-0'],
        ['caio', 'ana', 'caio', 'T-1'],
        ['ana', 'ana', 'ana', 'T-2'],
        ['bia', null, 'caio', ''],
        [null, 'ana', 'ana', 'T-4'],
      ],
    );
    const { table, problem } = await runOverShop(
      ['decide owner local=sheet remote=tracker last=last_owner hold-when-empty=found'],
      {},
      owners,
    );
    expect(problem).toBeUndefined();
    expect(table?.columns.find(({ name }) => name === 'owner_pushes')?.type).toBe('boolean');
    expect(Object.values(columnOf(table, 'owner_action'))).toEqual([
      'push',
      'pull',
      'same',
      'hold',
      'pull',
    ]);
    expect(Object.values(columnOf(table, 'owner_pushes'))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(Object.values(columnOf(table, 'owner_push'))).toEqual(['bia', null, null, null, null]);
    // A cleared local value is not a push today: decideValue never pushes an empty local value
    // (decidir_responsavel's rule), so the row pulls the tracker's value back. Letting a clear
    // push is left open in TYTO-647's pull request.
    expect(columnOf(table, 'owner_reason')['T-4']).toBe('local value not recognised');
  });

  describe('refuses', () => {
    it('a tie that is neither local nor remote', async () => {
      const { problem, at } = await run([`${DECIDE} tie=sheet`]);
      expect([problem?.code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'tie=sheet']);
      expect(problem?.message).toContain('tie=local or tie=remote');
    });

    it('a name that is a column other than local=', async () => {
      const { problem, at } = await run([
        'decide tracker local=sheet remote=tracker last=last_status',
      ]);
      expect([problem?.code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'tracker']);
    });

    async function refusal(line: string, files: Record<string, unknown> = {}) {
      const { problem, at } = await run([line], files);
      return [problem?.code, at];
    }

    it('a missing argument, naming it', async () => {
      const { problem } = await run(['decide status local=sheet remote=tracker']);
      expect(problem?.code).toBe('E_RECIPE_ARGUMENTS');
      expect(problem?.message).toContain('needs last=');
    });

    it('an argument given twice', async () => {
      expect(await refusal(`${DECIDE} local=tracker`)).toEqual([
        'E_RECIPE_ARGUMENTS',
        'local=tracker',
      ]);
    });

    it('an argument it does not take', async () => {
      expect(await refusal(`${DECIDE} winner=done`)).toEqual(['E_RECIPE_ARGUMENTS', 'winner=done']);
    });

    it('a name whose columns the table already has', async () => {
      const { problem, at } = await run([DECIDE, DECIDE]);
      expect([problem?.code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'status']);
      expect(problem?.message).toContain('status, status_action');
    });

    it('a name that cannot be a column', async () => {
      expect(await refusal('decide 1st local=sheet remote=tracker last=last_status')).toEqual([
        'E_RECIPE_ARGUMENTS',
        '1st',
      ]);
    });

    it('a first-run-wins value values= does not list', async () => {
      expect(await refusal(`${DECIDE} first-run-wins=finished`)).toEqual([
        'E_RECIPE_ARGUMENTS',
        'first-run-wins=finished',
      ]);
    });

    it('a column the table lacks', async () => {
      const [code] = await refusal('decide status local=sheet remote=jira last=last_status');
      expect(code).toBe('E_RECIPE_UNKNOWN_COLUMN');
    });

    it('a values list of the wrong shape in a file', async () => {
      const [code] = await refusal(
        'decide status local=sheet remote=tracker last=last_status values=@./flows.json',
        { './flows.json': { statuses: STATUSES } },
      );
      expect(code).toBe('E_RECIPE_DATA_SHAPE');
    });
  });
});

describe('last, decide and remember', () => {
  const LINES = [
    'last sync columns=status',
    'decide status local=sheet remote=tracker last=last_status ' +
      `${VALUES} first-run-wins=done hold-when-empty=found`,
    'remember sync columns=status when="status_action != hold"',
  ];

  it('remember what was decided, keep the old state of a held row, and decide from it', async () => {
    const state = memoryState();
    const first = await runWithState(
      LINES,
      tasks(
        ['sheet', 'tracker', 'found'],
        [
          ['done', 'todo', 'T-0'],
          ['todo', 'done', 'T-1'],
          ['done', null, ''],
        ],
      ),
      state,
    );
    expect(first.errors).toEqual([]);
    expect(column(first.table, 'status_action')).toEqual(['push', 'pull', 'hold']);
    for (const commit of stateToCommit(first.run.remembers, { operations: [] })) {
      await state.write(commit.store, commit.puts, commit.deletes);
    }
    expect([...(state.stores.get('sync')?.keys() ?? [])]).toEqual(['T-0', 'T-1']);

    const second = await runWithState(
      LINES,
      tasks(
        ['sheet', 'tracker', 'found'],
        [
          ['done', 'approval', 'T-0'],
          ['review', 'done', 'T-1'],
          ['done', 'doing', 'T-2'],
        ],
      ),
      state,
    );
    expect(second.errors).toEqual([]);
    expect(column(second.table, 'last_status')).toEqual(['done', 'done', null]);
    expect(column(second.table, 'status_action')).toEqual(['pull', 'push', 'push']);
    expect(column(second.table, 'status')).toEqual(['approval', 'review', 'done']);
  });
});

/**
 * TYTO-421: a shared field through a run that is applied with one write failing. The failed row
 * keeps its old state, so the next run decides it the same way and tries again.
 */
describe.each<DecideTie>(['local', 'remote'])('a shared field synced with tie=%s', (tie) => {
  const LINES = [
    'last sync columns=status',
    `decide status local=status remote=tracker last=last_status ${VALUES} ` +
      `hold-when-empty=found tie=${tie}`,
    'remember sync columns=status when="status_action != hold"',
  ];
  const INPUT = tasks(
    ['status', 'tracker', 'found'],
    [
      ['done', 'doing', 'T-0'],
      ['doing', 'review', 'T-1'],
      ['done', 'approval', 'T-2'],
      ['doing', 'doing', 'T-3'],
    ],
  );
  const INITIAL = {
    sync: {
      'T-0': { status: 'doing' },
      'T-1': { status: 'doing' },
      'T-2': { status: 'doing' },
      'T-3': { status: 'doing' },
    },
  };

  it('advances the state of every row but the one whose write failed', async () => {
    const state = memoryState(INITIAL);
    const first = await runWithState(LINES, INPUT, state);
    expect(first.errors).toEqual([]);
    const both = tie === 'local' ? 'push' : 'pull';
    expect(column(first.table, 'status_action')).toEqual(['push', 'pull', both, 'same']);
    expect(column(first.table, 'status_push')).toEqual([
      'done',
      null,
      tie === 'local' ? 'done' : null,
      null,
    ]);

    const outcome = {
      operations: [
        { rowKey: 'T-0', status: 'applied' as const, appliedAt: '2026-11-08T12:00:00.000Z' },
        { rowKey: 'T-1', status: 'applied' as const, appliedAt: '2026-11-08T12:00:01.000Z' },
        { rowKey: 'T-2', status: 'failed' as const, reason: 'the write was refused' },
      ],
    };
    for (const commit of stateToCommit(first.run.remembers, outcome)) {
      await state.write(commit.store, commit.puts, commit.deletes);
    }
    const stored = state.stores.get('sync');
    expect(stored?.get('T-0')?.values.status).toBe('done');
    expect(stored?.get('T-1')?.values.status).toBe('review');
    expect(stored?.get('T-2')?.values).toEqual({ status: 'doing' });
    expect(stored?.get('T-3')?.values.status).toBe('doing');

    // What the applied writes left on both sides; T-2's write did not happen.
    const after = tasks(
      ['status', 'tracker', 'found'],
      [
        ['done', 'done', 'T-0'],
        ['review', 'review', 'T-1'],
        ['done', 'approval', 'T-2'],
        ['doing', 'doing', 'T-3'],
      ],
    );
    const second = await runWithState(LINES, after, state);
    expect(second.errors).toEqual([]);
    expect(column(second.table, 'status_action')).toEqual(['same', 'same', both, 'same']);
    expect(column(second.table, 'status_overwritten')[2]).toBe(
      tie === 'local' ? 'approval' : 'done',
    );
  });
});
