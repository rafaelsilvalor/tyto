import { describe, expect, it } from 'vitest';

import { PLAN_LIMITS, type Plan, type PlanContext, checkPlan } from './plan.js';
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
      problemOf(planOf([...one, ...one, ...one]), {
        ...PLAN_LIMITS,
        maxOperations: 2,
        maxDescriptionLength: 10,
      }),
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
        { ...PLAN_LIMITS, maxOperations: 10, maxDescriptionLength: 10 },
      ),
    ).toBe(
      "'test.mark' answered a plan that operation 1 writes 'delete', and the verb declares " +
        "mark; operation 2 names the row 'T-9', which the table does not hold; operation 3 has " +
        'no description; operation 4 has a description of 11 characters, over 10.',
    );
  });

  it('passes a payload at the ceiling and refuses one a byte past it, counted as UTF-8', () => {
    // `"é…"` is two quotes and two bytes per letter: 20 letters are 42 bytes of JSON.
    const limits = { ...PLAN_LIMITS, maxPayloadBytes: 42 };
    const at = { write: 'mark', rowKey: 'T-1', description: 'Mark', payload: 'é'.repeat(20) };
    const checked = checkPlan(planOf([at]), CONTEXT, limits);
    expect(checked.ok && checked.value.operations[0]?.payload).toBe('é'.repeat(20));
    expect(problemOf(planOf([{ ...at, payload: 'é'.repeat(20) + 'x' }]), limits)).toBe(
      "'test.mark' answered a plan that operation 1 has a payload of 43 bytes, over 42.",
    );
  });

  it('holds a payload to 2,048 bytes by default', () => {
    expect(PLAN_LIMITS.maxPayloadBytes).toBe(2048);
    const payload = { target: 'T-9', read: 'x'.repeat(2048) };
    expect(problemOf(planOf([{ write: 'mark', description: 'Mark', payload }]))).toBe(
      "'test.mark' answered a plan that operation 1 has a payload of 2074 bytes, over 2048.",
    );
  });
});
