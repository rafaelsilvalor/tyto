import { type Diagnostic, err, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import { compileFormat, stampInstant } from './age.js';
import type { RunClock } from './clock.js';
import { parseRecipe } from './parse.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import type { CellValue, Table } from './table.js';

const AGE = 'age done format="dd-MM HH:mm,dd-MM" year=infer-past into=age';
const SAO_PAULO = -180;

/** A clock stopped at `now`, in a zone `offset` minutes from UTC. */
function clockAt(now: string, offset = 0): RunClock {
  return { now: () => new Date(now), offsetMinutes: () => offset };
}

interface Ran {
  readonly table: Table | undefined;
  readonly diagnostics: readonly Diagnostic[];
  readonly at: string | undefined;
}

async function run(
  lines: readonly string[],
  stamps: readonly CellValue[],
  clock: RunClock,
  included: Record<string, string> = {},
): Promise<Ran> {
  const source = ['recipe stamps', ...lines].join('\n');
  const recipe = parseRecipe(source);
  if (!recipe.ok) throw new Error(recipe.error.map(({ message }) => message).join('\n'));
  const result = await runRecipe(recipe.value, {
    input: tasks(
      ['done'],
      stamps.map((stamp) => [stamp]),
    ),
    verbs: createVerbRegistry(),
    derivations: createDerivationRegistry(),
    resolveRecipe: (name) => {
      const text = included[name];
      if (text === undefined) return Promise.resolve(err([]));
      const parsed = parseRecipe(text);
      return Promise.resolve(parsed.ok ? ok(parsed.value) : err(parsed.error));
    },
    clock,
  });
  if (!result.ok) throw new Error('the run must start');
  const diagnostics = result.value.cells.flatMap((cell) => cell.diagnostics);
  const range = diagnostics[0]?.range;
  const at = range === undefined ? undefined : source.slice(range.start, range.end);
  return { table: result.value.table, diagnostics, at };
}

/** The age of each stamp, in order, read by `AGE` against `clock`. */
async function ages(stamps: readonly CellValue[], clock: RunClock): Promise<readonly CellValue[]> {
  const { table, diagnostics } = await run([AGE], stamps, clock);
  expect(diagnostics.filter((found) => found.severity === 'error')).toEqual([]);
  return table?.rows.map((row) => row.values['age'] ?? null) ?? [];
}

/** The instant a stamp names, read with Buraqueira's two formats. */
function instant(text: string, now: string, offset = 0): string | undefined {
  const formats = ['dd-MM HH:mm', 'dd-MM'].map((format) => {
    const compiled = compileFormat(format);
    if (!compiled.ok) throw new Error(compiled.error);
    return compiled.value;
  });
  return stampInstant(formats, text, clockAt(now, offset), new Date(now))?.toISOString();
}

describe('age', () => {
  // Buraqueira: test_carimbo_ida_e_volta (the read half; Tyto does not write stamps here)
  it('reads a stamp as the wall-clock time it names, in the year of the clock', async () => {
    expect(instant('01-10 16:17', '2026-10-03T12:00:00Z')).toBe('2026-10-01T16:17:00.000Z');
    expect(await ages(['01-10 16:17'], clockAt('2026-10-03T16:17:00Z'))).toEqual([48]);
  });

  // Buraqueira: test_carimbo_de_dezembro_lido_em_janeiro_e_do_ano_anterior
  it('reads a December stamp in January as last year', async () => {
    expect(instant('30-12 09:00', '2027-01-02T00:00:00Z')).toBe('2026-12-30T09:00:00.000Z');
    expect(await ages(['30-12 09:00'], clockAt('2027-01-02T00:00:00Z'))).toEqual([63]);
  });

  // Buraqueira: test_carimbo_de_29_de_fevereiro
  it('reads 29-02 in a leap year, and in the year after from the leap year before', async () => {
    expect(instant('29-02 10:00', '2028-03-01T00:00:00Z')).toBe('2028-02-29T10:00:00.000Z');
    expect(instant('29-02 10:00', '2029-01-10T00:00:00Z')).toBe('2028-02-29T10:00:00.000Z');
    expect(instant('29-02 10:00', '2027-03-01T00:00:00Z')).toBeUndefined();
  });

  // Buraqueira: test_dd_mm_antigo_vale_como_carimbo_a_meia_noite
  it('reads a date without a time as midnight, and gives an empty or unread cell no age', async () => {
    expect(instant('30-09', '2026-10-03T12:00:00Z')).toBe('2026-09-30T00:00:00.000Z');
    const { table, diagnostics } = await run(
      [AGE],
      ['30-09', '', null, 'yesterday'],
      clockAt('2026-10-03T12:00:00Z'),
    );
    expect(table?.rows.map((row) => row.values['age'])).toEqual([84, null, null, null]);
    expect(diagnostics.map((found) => found.code)).toEqual(['W_RECIPE_AGE_UNREAD']);
  });

  // Buraqueira: test_prazo_e_de_72_horas_inclusive
  it('holds a stamp exactly 72 hours, so where age >= 72 keeps it and not one a minute later', async () => {
    const stamps = ['01-10 12:00', '01-10 12:01'];
    const now = clockAt('2026-10-04T12:00:30Z');
    expect(await ages(stamps, now)).toEqual([72, 4319 / 60]);
    const { table } = await run([AGE, 'where age >= 72'], stamps, now);
    expect(table?.rows.map((row) => row.values['done'])).toEqual(['01-10 12:00']);
  });

  it('writes a number column, added at the end', async () => {
    const { table } = await run([AGE], ['01-10 12:00'], clockAt('2026-10-04T12:00:00Z'));
    expect(table?.columns.at(-1)).toEqual({ name: 'age', type: 'number', origin: 'age' });
  });

  it('reads a stamp up to a day ahead as this year, with a negative age, and later as last year', async () => {
    const now = '2026-10-04T12:00:00Z';
    expect(await ages(['05-10 11:00'], clockAt(now))).toEqual([-23]);
    expect(instant('05-10 13:00', now)).toBe('2025-10-05T13:00:00.000Z');
  });

  it('reads the stamp as wall-clock time in the clock’s offset', async () => {
    // 12:00 in São Paulo is 15:00 UTC: 72 hours there, 75 for a clock in UTC.
    const now = '2026-10-04T15:00:00Z';
    expect(await ages(['01-10 12:00'], clockAt(now, SAO_PAULO))).toEqual([72]);
    expect(await ages(['01-10 12:00'], clockAt(now))).toEqual([75]);
  });

  it('takes the clock’s year from its wall clock, not from UTC', () => {
    // 22:00 UTC on New Year's Eve is already 2027 three hours east, so 01-01 is this year's.
    expect(instant('01-01 00:30', '2026-12-31T22:00:00Z', 180)).toBe('2026-12-31T21:30:00.000Z');
  });

  it('reads one or two digits and a cell with blanks around it, like strptime', async () => {
    expect(await ages([' 1-10 9:05 '], clockAt('2026-10-01T10:05:00Z'))).toEqual([1]);
  });

  it('tries the formats in order and reads a year a format writes', async () => {
    const line = 'age done format="yyyy-MM-dd HH:mm,dd/MM/yyyy" into=age';
    const { table, diagnostics } = await run(
      [line],
      ['2025-10-04 12:00', '04/10/2024'],
      clockAt('2026-10-04T12:00:00Z'),
    );
    expect(diagnostics).toEqual([]);
    expect(table?.rows.map((row) => row.values['age'])).toEqual([365 * 24, 730 * 24 + 12]);
  });

  it('reads the run’s clock inside a recipe that run includes', async () => {
    const { table } = await run(['run stamped'], ['01-10 12:00'], clockAt('2030-10-04T12:00:00Z'), {
      stamped: `recipe stamped\n${AGE}`,
    });
    expect(table?.rows.map((row) => row.values['age'])).toEqual([72]);
  });

  it('warns once per step, counting the cells no format reads', async () => {
    const { diagnostics, at } = await run(
      [AGE],
      ['soon', '01-10 12:00', '31-02', '01-10 25:00'],
      clockAt('2026-10-04T12:00:00Z'),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toBe(
      "3 cell(s) of 'done' match none of the formats 'dd-MM HH:mm,dd-MM' and have no age.",
    );
    expect(at).toBe('done format="dd-MM HH:mm,dd-MM" year=infer-past into=age');
  });

  describe('refuses', () => {
    async function refusal(line: string) {
      const { diagnostics, at } = await run([line], ['01-10'], clockAt('2026-10-04T12:00:00Z'));
      return [diagnostics[0]?.code, at];
    }

    it('a format without yyyy and no year=', async () => {
      const [code, at] = await refusal('age done format=dd-MM into=age');
      expect([code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'format=dd-MM']);
    });

    it('year= when every format has yyyy', async () => {
      const [code, at] = await refusal('age done format=dd-MM-yyyy year=infer-past into=age');
      expect([code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'year=infer-past']);
    });

    it('a year= other than infer-past', async () => {
      const [code, at] = await refusal('age done format=dd-MM year=2026 into=age');
      expect([code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'year=2026']);
    });

    it('a letter outside a token, a token twice, or an hour without its minutes', async () => {
      for (const format of ['DD-MM', 'dd-MM-dd', 'dd-MM HH', 'MM-yyyy']) {
        const [code, at] = await refusal(`age done format="${format}" year=infer-past into=age`);
        expect([code, at]).toEqual(['E_RECIPE_ARGUMENTS', `format="${format}"`]);
      }
    });

    it('an argument it does not take', async () => {
      const [code, at] = await refusal(`${AGE} zone=utc`);
      expect([code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'zone=utc']);
    });

    it('an argument given twice', async () => {
      const [code, at] = await refusal(`${AGE} into=other`);
      expect([code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'into=other']);
    });

    it('a missing format=, and a second column', async () => {
      expect((await refusal('age done into=age'))[0]).toBe('E_RECIPE_ARGUMENTS');
      const [code, at] = await refusal('age done key format=dd-MM year=infer-past into=age');
      expect([code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'key']);
    });

    it('a column it cannot write', async () => {
      const [code, at] = await refusal('age done format=dd-MM year=infer-past into=1st');
      expect([code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'into=1st']);
    });

    it('a column the table lacks', async () => {
      const [code] = await refusal('age finished format=dd-MM year=infer-past into=age');
      expect(code).toBe('E_RECIPE_UNKNOWN_COLUMN');
    });
  });
});
