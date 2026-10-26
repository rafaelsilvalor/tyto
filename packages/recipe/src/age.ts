import { type Result, diagnostic, err, ok } from '@tyto/core';

import type { NamedArgument } from './ast.js';
import { type RunClock, instantOf, systemClock, wallClock } from './clock.js';
import { resolveColumn } from './columns.js';
import { withColumns } from './compose.js';
import type { VerbContext, VerbResult } from './registry.js';
import { argumentsProblem, locate, requireTable } from './support.js';
import { type CellValue, cellText } from './table.js';

const COLUMN_NAME = /^[A-Za-z_][\w-]*$/u;
const NAMES = ['format', 'year', 'into', 'month-into'] as const;
const MINUTE = 60_000;
/** How far ahead of now an inferred year may put a stamp: a clock a day off still reads. */
const TOLERANCE = 24 * 60 * MINUTE;

type Field = 'day' | 'month' | 'year' | 'hour' | 'minute';

const TOKENS: readonly (readonly [string, Field])[] = [
  ['yyyy', 'year'],
  ['dd', 'day'],
  ['MM', 'month'],
  ['HH', 'hour'],
  ['mm', 'minute'],
];

/** One format of `format=`, compiled: its pattern and which field each group holds. */
export interface StampFormat {
  readonly text: string;
  readonly pattern: RegExp;
  readonly fields: readonly Field[];
  readonly hasYear: boolean;
}

/**
 * Compiles `dd-MM HH:mm`: the tokens dd, MM, yyyy, HH and mm, each once, and any other
 * character literally, a run of blanks matching any run of blanks. Like `strptime`, a two-letter
 * token reads one or two digits, so `1-9 7:05` reads with `dd-MM HH:mm`; yyyy reads four. A
 * day and a month are required, and an hour comes with its minutes.
 */
export function compileFormat(text: string): Result<StampFormat, string> {
  const fields: Field[] = [];
  let source = '';
  for (let index = 0; index < text.length;) {
    const token = TOKENS.find(([written]) => text.startsWith(written, index));
    if (token !== undefined) {
      const [written, field] = token;
      if (fields.includes(field)) return err(`format '${text}' has ${written} twice`);
      fields.push(field);
      source += field === 'year' ? '(\\d{4})' : '(\\d{1,2})';
      index += written.length;
      continue;
    }
    const character = text.charAt(index);
    if (/[A-Za-z]/u.test(character)) {
      return err(
        `format '${text}' has '${character}' outside a token; the tokens are dd, MM, yyyy, HH ` +
          'and mm',
      );
    }
    if (/\s/u.test(character)) {
      source += '\\s+';
      while (index < text.length && /\s/u.test(text.charAt(index))) index++;
      continue;
    }
    source += character.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
    index++;
  }
  if (!fields.includes('day') || !fields.includes('month')) {
    return err(`format '${text}' needs dd and MM`);
  }
  if (fields.includes('hour') !== fields.includes('minute')) {
    return err(`format '${text}' needs HH and mm together, or neither`);
  }
  return ok({
    text,
    pattern: new RegExp(`^${source}$`, 'u'),
    fields,
    hasYear: fields.includes('year'),
  });
}

/**
 * The wall-clock time a text names in `format`, as a UTC timestamp of its fields, with `year`
 * when the format has none; none when it does not match or names a date the calendar lacks,
 * such as 29-02 in a common year. A missing time is midnight.
 */
export function readStamp(format: StampFormat, text: string, year: number): number | undefined {
  const match = format.pattern.exec(text);
  if (match === null) return undefined;
  const value = (field: Field, otherwise: number): number => {
    const at = format.fields.indexOf(field);
    return at === -1 ? otherwise : Number(match[at + 1]);
  };
  const parts = {
    year: value('year', year),
    month: value('month', 0),
    day: value('day', 0),
    hour: value('hour', 0),
    minute: value('minute', 0),
  };
  if (parts.hour > 23 || parts.minute > 59) return undefined;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  // Date.UTC treats a year below 100 as 1900 onwards; yyyy is four digits, so it never is one.
  const exists =
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day;
  return exists ? date.getTime() : undefined;
}

/**
 * The instant a stamp names, ported from Buraqueira's `ler_carimbo`. A format with yyyy says
 * its year. One without takes the clock's year, then the year before: the first year in which
 * a format matches, the formats tried in order, and which is no later than a day after now.
 * That reads a December stamp in January as last year's and a 29-02 in a common year as the
 * leap year's before; the year enters the read, as in Buraqueira, so 29-02 is not refused
 * against a year it was never written in.
 */
export function stampInstant(
  formats: readonly StampFormat[],
  text: string,
  clock: RunClock,
  now: Date,
): Date | undefined {
  const clockYear = wallClock(clock, now).getUTCFullYear();
  const latest = now.getTime() + TOLERANCE;
  for (const year of [clockYear, clockYear - 1]) {
    for (const format of formats) {
      const wall = readStamp(format, text, year);
      if (wall === undefined) continue;
      const instant = instantOf(clock, wall);
      if (format.hasYear || instant.getTime() <= latest) return instant;
      break;
    }
  }
  return undefined;
}

/**
 * The text `format` writes for a wall-clock time given as a UTC date's fields: each token two
 * digits, yyyy four, and every other character as written. `stamp` writes with it, so what it
 * writes is what `readStamp` reads back with the same format.
 */
export function formatStamp(format: StampFormat, wall: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  const fieldText: Record<Field, string> = {
    year: String(wall.getUTCFullYear()).padStart(4, '0'),
    month: two(wall.getUTCMonth() + 1),
    day: two(wall.getUTCDate()),
    hour: two(wall.getUTCHours()),
    minute: two(wall.getUTCMinutes()),
  };
  let text = '';
  for (let index = 0; index < format.text.length;) {
    const token = TOKENS.find(([written]) => format.text.startsWith(written, index));
    if (token === undefined) {
      text += format.text.charAt(index);
      index++;
      continue;
    }
    text += fieldText[token[1]];
    index += token[0].length;
  }
  return text;
}

/** The month a stamp files under, `yyyy-MM` on the wall clock: Buraqueira's `mes_de`. */
export function monthOf(clock: RunClock, instant: Date): string {
  const wall = wallClock(clock, instant);
  return `${String(wall.getUTCFullYear())}-${String(wall.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Hours from `then` to `now` in whole minutes, so 72 hours is exactly 72. */
export function hoursBetween(then: Date, now: Date): number {
  return Math.floor((now.getTime() - then.getTime()) / MINUTE) / 60;
}

/**
 * `age <column> format="dd-MM HH:mm,dd-MM" [year=infer-past] into=<column>` writes how many
 * hours ago each cell's stamp was, read against the run's clock (ADR 0139), as Buraqueira read
 * the stamp it wrote when a task was done and held it 72 hours: `age done-at format="dd-MM
 * HH:mm,dd-MM" year=infer-past into=age` followed by `where age >= 72`.
 *
 * `format=` is a comma-separated list tried in order (`compileFormat`). A stamp is wall-clock
 * time in the clock's offset. A format without yyyy needs `year=infer-past`, which reads the
 * year as `stampInstant` does; with yyyy in every format it is refused, since there is nothing
 * to infer. The column is a number of hours, whole minutes over 60, added at the end or
 * recomputed in place; negative within the day an inferred year allows. An empty cell writes
 * an empty cell, and so does one no format reads, which one warning per step counts.
 *
 * `month-into=<column>` also writes the month the stamp files under, `yyyy-MM` on the wall
 * clock with the year read as above (Buraqueira's `mes_de`), empty where the age is.
 */
export function age(context: VerbContext): VerbResult {
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  const usage =
    'takes one column, format= its stamp formats and into= the column it writes, as in ' +
    'age done-at format="dd-MM HH:mm,dd-MM" year=infer-past into=age';

  const written = new Map<string, NamedArgument>();
  for (const argument of context.step.named) {
    if (!(NAMES as readonly string[]).includes(argument.name)) {
      return argumentsProblem(
        context,
        `does not take '${argument.name}='; ${usage}`,
        at(argument.range),
      );
    }
    if (written.has(argument.name)) {
      return argumentsProblem(context, `was given '${argument.name}=' twice`, at(argument.range));
    }
    written.set(argument.name, argument);
  }
  const formatArgument = written.get('format');
  const yearArgument = written.get('year');
  const into = written.get('into');
  const [source, extra] = context.step.positional;
  if (formatArgument === undefined || into === undefined || source === undefined) {
    return argumentsProblem(context, usage);
  }
  if (extra !== undefined) return argumentsProblem(context, usage, at(extra.range));
  if (!COLUMN_NAME.test(into.value)) {
    return argumentsProblem(context, `cannot write a column named '${into.value}'`, at(into.range));
  }
  const monthInto = written.get('month-into');
  if (monthInto !== undefined && !COLUMN_NAME.test(monthInto.value)) {
    return argumentsProblem(
      context,
      `cannot write a column named '${monthInto.value}'`,
      at(monthInto.range),
    );
  }
  if (monthInto !== undefined && monthInto.value.toLowerCase() === into.value.toLowerCase()) {
    return argumentsProblem(
      context,
      `writes the hours and the month into two columns, not both into '${into.value}'`,
      at(monthInto.range),
    );
  }

  const formats: StampFormat[] = [];
  for (const piece of formatArgument.value.split(',')) {
    const compiled = compileFormat(piece.trim());
    if (!compiled.ok) return argumentsProblem(context, compiled.error, at(formatArgument.range));
    formats.push(compiled.value);
  }
  const yearless = formats.find((format) => !format.hasYear);
  if (yearArgument !== undefined && yearArgument.value !== 'infer-past') {
    return argumentsProblem(
      context,
      `takes year=infer-past, not year=${yearArgument.value}`,
      at(yearArgument.range),
    );
  }
  if (yearArgument === undefined && yearless !== undefined) {
    return argumentsProblem(
      context,
      `reads format '${yearless.text}', which has no yyyy; say where the year comes from ` +
        'with year=infer-past',
      at(formatArgument.range),
    );
  }
  if (yearArgument !== undefined && yearless === undefined) {
    return argumentsProblem(
      context,
      'has yyyy in every format, so there is no year to infer; drop year=',
      at(yearArgument.range),
    );
  }

  const column = resolveColumn(table.value, source.value, at(source.range), context.aliases);
  if (!column.ok) return column;

  const clock = context.clock ?? systemClock;
  const now = clock.now();
  let unread = 0;
  const instantOfCell = (value: CellValue | undefined): Date | undefined => {
    const text = cellText(value).trim();
    if (text === '') return undefined;
    const instant = stampInstant(formats, text, clock, now);
    if (instant === undefined) unread++;
    return instant;
  };
  const produced = [
    { name: into.value, type: 'number' as const },
    ...(monthInto === undefined ? [] : [{ name: monthInto.value, type: 'text' as const }]),
  ];
  const result = withColumns(table.value, produced, 'age', (row) => {
    const instant = instantOfCell(row.values[column.value.name]);
    const values: Record<string, CellValue> = {
      [into.value]: instant === undefined ? null : hoursBetween(instant, now),
    };
    if (monthInto !== undefined) {
      values[monthInto.value] = instant === undefined ? null : monthOf(clock, instant);
    }
    return values;
  });
  const warnings =
    unread === 0
      ? []
      : [
          diagnostic(
            'W_RECIPE_AGE_UNREAD',
            {
              count: unread,
              column: column.value.name,
              format: formatArgument.value,
            },
            { range: context.written.textRange },
          ),
        ];
  return ok({ table: result }, warnings);
}
