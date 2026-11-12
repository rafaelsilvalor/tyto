import { type Diagnostic, err } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import type { RunClock } from './clock.js';
import { readInstant } from './local.js';
import { parseRecipe } from './parse.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import type { CellValue, Table } from './table.js';
import { parseTemplate } from './template.js';

/**
 * `{column|local:<format>}` (TYTO-675): a tracker's UTC instant written as wall-clock time in
 * the run's zone, the date rolling back with the hour.
 */

const NOW = '2026-11-12T12:00:00Z';
const SAO_PAULO = -180;

/** A clock in a fixed offset and no named zone, as `systemClock` and a test give. */
function offsetClock(offset: number): RunClock {
  return { now: () => new Date(NOW), offsetMinutes: () => offset };
}

/**
 * A clock that names `zone` but answers a wrong offset, so a test passing through the offset
 * instead of the zone fails.
 */
function zoneClock(zone: string): RunClock {
  return { now: () => new Date(NOW), offsetMinutes: () => 0, timeZone: zone };
}

interface Ran {
  readonly table: Table | undefined;
  readonly diagnostics: readonly Diagnostic[];
  readonly at: string | undefined;
}

async function run(
  lines: readonly string[],
  dues: readonly CellValue[],
  clock: RunClock,
): Promise<Ran> {
  const source = ['recipe local', ...lines].join('\n');
  const recipe = parseRecipe(source);
  if (!recipe.ok) throw new Error(recipe.error.map(({ message }) => message).join('\n'));
  const result = await runRecipe(recipe.value, {
    input: tasks(
      ['due'],
      dues.map((due) => [due]),
    ),
    verbs: createVerbRegistry(),
    derivations: createDerivationRegistry(),
    resolveRecipe: () => Promise.resolve(err([])),
    clock,
  });
  if (!result.ok) throw new Error('the run must start');
  const diagnostics = result.value.cells.flatMap((cell) => cell.diagnostics);
  const range = diagnostics[0]?.range;
  const at = range === undefined ? undefined : source.slice(range.start, range.end);
  return { table: result.value.table, diagnostics, at };
}

const DATE_AND_TIME = [
  'compose day="{due|local:yyyy-MM-dd}"',
  'compose hour="{due|local:HH:mm}"',
  'compose both="{due|local:dd/MM/yyyy HH:mm}"',
];

/** Each row's `[day, hour, both]`, with no diagnostic. */
async function written(dues: readonly CellValue[], clock: RunClock): Promise<CellValue[][]> {
  const { table, diagnostics } = await run(DATE_AND_TIME, dues, clock);
  expect(diagnostics).toEqual([]);
  return (table?.rows ?? []).map((row) => [
    row.values['day'] ?? null,
    row.values['hour'] ?? null,
    row.values['both'] ?? null,
  ]);
}

describe('the local filter', () => {
  it('rolls the date back with the hour in a fixed offset', async () => {
    expect(
      await written(['2026-11-12T01:30:00Z', '2026-11-12T03:30:00Z'], offsetClock(SAO_PAULO)),
    ).toEqual([
      ['2026-11-11', '22:30', '11/11/2026 22:30'],
      ['2026-11-12', '00:30', '12/11/2026 00:30'],
    ]);
  });

  it('gives the same answers through the named zone, and ignores the offset then', async () => {
    expect(
      await written(
        ['2026-11-12T01:30:00Z', '2026-11-12T03:30:00Z'],
        zoneClock('America/Sao_Paulo'),
      ),
    ).toEqual([
      ['2026-11-11', '22:30', '11/11/2026 22:30'],
      ['2026-11-12', '00:30', '12/11/2026 00:30'],
    ]);
  });

  it('follows daylight saving in a named zone: Lisbon is UTC+1 in July and UTC in January', async () => {
    expect(
      await written(['2026-07-15T23:30:00Z', '2026-01-15T23:30:00Z'], zoneClock('Europe/Lisbon')),
    ).toEqual([
      ['2026-07-16', '00:30', '16/07/2026 00:30'],
      ['2026-01-15', '23:30', '15/01/2026 23:30'],
    ]);
  });

  it('reads an instant with an offset, with or without the colon, and with fractions', async () => {
    expect(
      await written(
        ['2026-11-11T22:30:00.000-0300', '2026-11-12T02:30:00+01:00', '2026-11-12T01:30Z'],
        offsetClock(0),
      ),
    ).toEqual([
      ['2026-11-12', '01:30', '12/11/2026 01:30'],
      ['2026-11-12', '01:30', '12/11/2026 01:30'],
      ['2026-11-12', '01:30', '12/11/2026 01:30'],
    ]);
  });

  it('leaves an empty cell empty, and warns once for the cells that are not an instant', async () => {
    const { table, diagnostics, at } = await run(
      ['compose day="{due|local:yyyy-MM-dd}"'],
      ['2026-11-12T01:30:00Z', null, '', 'tomorrow', '2026-11-12', '2026-02-30T10:00:00Z'],
      offsetClock(SAO_PAULO),
    );
    expect(table?.rows.map((row) => row.values['day'] ?? null)).toEqual([
      '2026-11-11',
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(diagnostics.map(({ code, severity }) => [code, severity])).toEqual([
      ['W_RECIPE_LOCAL_UNREAD', 'warning'],
    ]);
    expect(diagnostics[0]?.message).toContain("3 cell(s) of 'due'");
    expect(at).toBe('day="{due|local:yyyy-MM-dd}"');
  });

  it('refuses an unknown token at the template, before any row is read', async () => {
    const { table, diagnostics, at } = await run(
      ['compose day="{due|local:yyyy-MM-DD}"'],
      ['2026-11-12T01:30:00Z'],
      offsetClock(0),
    );
    expect(table).toBeUndefined();
    expect(diagnostics.map(({ code }) => code)).toEqual(['E_RECIPE_TEMPLATE']);
    expect(diagnostics[0]?.message).toContain("has 'D' outside a token");
    expect(at).toBe('day="{due|local:yyyy-MM-DD}"');
  });
});

describe('parsing the local filter', () => {
  it('keeps the format with the filter, among the others', () => {
    const parsed = parseTemplate('{due|trim|local:dd/MM HH:mm|upper}');
    expect(parsed.ok && parsed.value.parts).toEqual([
      {
        kind: 'column',
        column: 'due',
        filters: ['trim', { name: 'local', format: 'dd/MM HH:mm' }, 'upper'],
      },
    ]);
  });

  it.each([
    ['{due|local}', 'without a format'],
    ['{due|local:}', 'needs a format after local:'],
    ['{due|local:HH:mm:ss}', "has 's' outside a token"],
    ['{due|local:HH HH}', 'has HH twice'],
    ['{due|slug:x}', 'an argument it does not take'],
    ['{due|local:{x}', "has the placeholder '{due|local:{x}'"],
  ])('refuses %s', (text, problem) => {
    const parsed = parseTemplate(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(problem);
  });
});

describe('readInstant', () => {
  it.each([
    ['2026-11-12T01:30:00Z', '2026-11-12T01:30:00.000Z'],
    ['2026-11-12t01:30:00z', '2026-11-12T01:30:00.000Z'],
    ['2026-11-11T22:30:00.123-03:00', '2026-11-12T01:30:00.000Z'],
    ['2026-11-12T05:00:00+0530', '2026-11-11T23:30:00.000Z'],
  ])('reads %s', (text, expected) => {
    expect(readInstant(text)?.toISOString()).toBe(expected);
  });

  it.each([
    '2026-11-12',
    '2026-11-12T01:30:00',
    '2026-13-01T00:00:00Z',
    '2026-02-29T00:00:00Z',
    '2026-11-12T24:00:00Z',
    '2026-11-12T01:30:00+25:00',
    '12/11/2026 01:30',
  ])('refuses %s', (text) => {
    expect(readInstant(text)).toBeUndefined();
  });
});
