import { describe, expect, it } from 'vitest';

import { type Plan, type PlanContext, checkPlan } from './plan.js';
import type { Table } from './table.js';

const TABLE: Table = {
  columns: [],
  rows: ['T-1', 'T-2'].map((key) => ({
    key,
    values: {},
    provenance: { source: 'test', id: key, fetchedAt: '2026-10-24' },
  })),
};

const CONTEXT: PlanContext = { verb: 'test.mark', writes: ['mark'], table: TABLE };

const planOf = (operations: Plan['operations'], count = operations.length): Plan => ({
  target: 'test items',
  operations,
  count,
});

function problemOf(plan: Plan, limits?: Parameters<typeof checkPlan>[2]): string {
  const checked = checkPlan(plan, CONTEXT, limits);
  return checked.ok ? 'ok' : (checked.error[0]?.message ?? '');
}

describe('checkPlan', () => {
  it('passes a plan of declared writes on rows the table holds, unchanged', () => {
    const plan = planOf([
      { write: 'mark', rowKey: 'T-1', description: 'Mark T-1' },
      { write: 'mark', description: 'Mark the project' },
    ]);
    const checked = checkPlan(plan, CONTEXT);
    expect(checked.ok && checked.value).toBe(plan);
  });

  it('refuses a miscount, a missing target and a plan past the ceiling, with the numbers', () => {
    const one = [{ write: 'mark', description: 'Mark' }];
    expect(problemOf(planOf(one, 2))).toBe(
      "'test.mark' answered a plan that counts 2 operations and lists 1.",
    );
    expect(problemOf({ ...planOf(one), target: ' ' })).toBe(
      "'test.mark' answered a plan that names no target.",
    );
    expect(
      problemOf(planOf([...one, ...one, ...one]), { maxOperations: 2, maxDescriptionLength: 10 }),
    ).toBe("'test.mark' answered a plan that has 3 operations, over 2.");
  });

  it('names each operation that is wrong: an undeclared write, an unknown row, a description', () => {
    expect(
      problemOf(
        planOf([
          { write: 'delete', rowKey: 'T-1', description: 'Delete T-1' },
          { write: 'mark', rowKey: 'T-9', description: 'Mark T-9' },
          { write: 'mark', description: '' },
          { write: 'mark', description: 'x'.repeat(11) },
        ]),
        { maxOperations: 10, maxDescriptionLength: 10 },
      ),
    ).toBe(
      "'test.mark' answered a plan that operation 1 writes 'delete', and the verb declares " +
        "mark; operation 2 names the row 'T-9', which the table does not hold; operation 3 has " +
        'no description; operation 4 has a description of 11 characters, over 10.',
    );
  });
});
