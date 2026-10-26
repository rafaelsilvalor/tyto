import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import { columnOf, runOverShop } from './__fixtures__/rules-harness.js';
import { column, memoryState, runWithState } from './__fixtures__/state-harness.js';
import { type DecideRules, type Decision, decideValue } from './decide.js';
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
    expect(decision).toEqual({ ...same('doing'), reason: 'nothing changed' });
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
    expect(table?.columns.slice(-4).map(({ name, type }) => [name, type])).toEqual([
      ['status', 'text'],
      ['status_action', 'text'],
      ['status_overrides', 'boolean'],
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

  describe('refuses', () => {
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
