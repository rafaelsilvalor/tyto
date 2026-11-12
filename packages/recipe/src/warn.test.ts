import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import { type Ran, runWithState } from './__fixtures__/state-harness.js';
import type { Table } from './table.js';
import { WARN_ROW_LIMIT } from './warn.js';

function run(lines: readonly string[], input: Table, files: Record<string, unknown> = {}) {
  return runWithState(lines, input, undefined, {}, { files });
}

/** Every diagnostic of the run's cells, as code and message. */
function reported(ran: Ran): readonly (readonly [string, string])[] {
  return ran.run.cells
    .flatMap((cell) => cell.diagnostics)
    .map(({ code, message }) => [code, message] as const);
}

const SHEET = tasks(
  ['status', 'owner'],
  [
    ['blocked', 'Ana'],
    ['doing', 'Bruno'],
    ['blocked', null],
  ],
);

const BLOCKED = 'warn when="status = blocked" message="{key|} is blocked, owner {owner|upper}"';

describe('warn', () => {
  it('reports each row when= keeps, in table order, with its key and its message', async () => {
    const ran = await run([BLOCKED], SHEET);
    expect(ran.errors).toEqual([]);
    expect(reported(ran)).toEqual([
      ['W_RECIPE_WARN', "Row 'T-0': T-0 is blocked, owner ANA"],
      ['W_RECIPE_WARN', "Row 'T-2': T-2 is blocked, owner "],
    ]);
  });

  it('points every warning at its own line', async () => {
    const ran = await run(['where status != done', BLOCKED], SHEET);
    const source = ['recipe sync', 'where status != done', BLOCKED].join('\n');
    const ranges = ran.run.cells[1]?.diagnostics.map(({ range }) =>
      source.slice(range?.start, range?.end),
    );
    expect(ranges).toEqual([BLOCKED, BLOCKED]);
  });

  it('passes the table through unchanged: same columns, rows and order', async () => {
    const ran = await run([BLOCKED], SHEET);
    expect(ran.table).toEqual(SHEET);
  });

  it('reports nothing when no row matches, and still passes the table on', async () => {
    const ran = await run(['warn when="status = cancelled" message="{key|}"'], SHEET);
    expect(reported(ran)).toEqual([]);
    expect(ran.table).toEqual(SHEET);
  });

  it('survives a later where that drops the row it reported', async () => {
    const ran = await run([BLOCKED, 'where status = doing'], SHEET);
    expect(ran.table?.rows.map((row) => row.key)).toEqual(['T-1']);
    expect(reported(ran).map(([code]) => code)).toEqual(['W_RECIPE_WARN', 'W_RECIPE_WARN']);
  });

  it(`lists ${String(WARN_ROW_LIMIT)} rows, then one warning counting the rest`, async () => {
    const many = tasks(
      ['status'],
      Array.from({ length: WARN_ROW_LIMIT + 40 }, (_, index) => [index === 3 ? 'done' : 'blocked']),
    );
    const ran = await run(['warn when="status = blocked" message="{key|}"'], many);
    const messages = reported(ran);
    expect(messages).toHaveLength(WARN_ROW_LIMIT + 1);
    expect(messages.every(([code]) => code === 'W_RECIPE_WARN')).toBe(true);
    expect(messages[0]).toEqual(['W_RECIPE_WARN', "Row 'T-0': T-0"]);
    // T-3 is done, so the hundredth listed row is T-100.
    expect(messages[WARN_ROW_LIMIT - 1]).toEqual(['W_RECIPE_WARN', "Row 'T-100': T-100"]);
    expect(messages[WARN_ROW_LIMIT]).toEqual([
      'W_RECIPE_WARN',
      '39 more row(s): matched when="status = blocked" and are not listed; one warn step lists 100',
    ]);
  });

  it(`adds no count when exactly ${String(WARN_ROW_LIMIT)} rows match`, async () => {
    const exact = tasks(
      ['status'],
      Array.from({ length: WARN_ROW_LIMIT }, () => ['blocked']),
    );
    const ran = await run(['warn when="status = blocked" message="{key|}"'], exact);
    const messages = reported(ran);
    expect(messages).toHaveLength(WARN_ROW_LIMIT);
    expect(messages.at(-1)).toEqual(['W_RECIPE_WARN', "Row 'T-99': T-99"]);
  });

  it('reads its message from a data file, as compose reads a template', async () => {
    const ran = await run(['warn when="status = doing" message=@./words.json#/doing'], SHEET, {
      './words.json': { doing: '{owner} is on {key}' },
    });
    expect(reported(ran)).toEqual([['W_RECIPE_WARN', "Row 'T-1': Bruno is on T-1"]]);
  });

  it.each([
    ['without message=', 'warn when="status = blocked"', 'warn when="status = blocked"'],
    ['without when=', 'warn message="{key|}"', 'warn message="{key|}"'],
    ['with a bare word', 'warn blocked when="status = blocked" message="x"', 'blocked'],
    [
      'with when= twice',
      'warn when="status = blocked" when="status = doing" message="x"',
      'when="status = doing"',
    ],
    [
      'with a name it does not take',
      'warn when="status = blocked" message="x" level=high',
      'level=high',
    ],
  ])('is an arguments problem %s', async (_case, line, at) => {
    const ran = await run([line], SHEET);
    expect(ran.errors.map(({ code }) => code)).toEqual(['E_RECIPE_ARGUMENTS']);
    expect(ran.at).toBe(at.startsWith('warn ') ? line.slice('warn '.length) : at);
  });

  it('names a column the table lacks, in when= or in the message', async () => {
    const inWhen = await run(['warn when="stauts = blocked" message="x"'], SHEET);
    expect(inWhen.errors.map(({ code }) => code)).toEqual(['E_RECIPE_UNKNOWN_COLUMN']);
    expect(inWhen.at).toBe('stauts');
    const inMessage = await run(['warn when="status = blocked" message="{onwer|}"'], SHEET);
    expect(inMessage.errors.map(({ code }) => code)).toEqual(['E_RECIPE_UNKNOWN_COLUMN']);
  });

  it('refuses a message that is not a template', async () => {
    const ran = await run(['warn when="status = blocked" message="{key|shout}"'], SHEET);
    expect(ran.errors.map(({ code }) => code)).toEqual(['E_RECIPE_TEMPLATE']);
  });
});
