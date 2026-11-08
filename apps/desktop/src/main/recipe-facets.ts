import { type CellValue, type RunClock, type Table, cellText, comparable } from '@tyto/recipe';

import { RECIPE_WIRE_LIMITS } from '../../shared/ipc.js';

/**
 * The groups a view draws a table in, counted in main (TYTO-381, ADR 0177).
 *
 * The window holds a cell's first rows only (ADR 0148), so a Board cannot count its columns: it
 * asks main, which counts over the rows the view's quick filter keeps (`recipe-rows.ts`) and
 * never moves a row of the kept table. Values group as `where` compares them, no case and no
 * accents, so `Done` and `done` are one column.
 */

export interface Facet {
  /** The group's name on the wire: JSON of the compared value, handed back to `recipe:rows`. */
  readonly key: string;
  /** The value as its first row wrote it. */
  readonly label: string;
  readonly count: number;
}

export interface Facets {
  readonly facets: readonly Facet[];
  /** Groups left out past the limit. */
  readonly more: number;
}

/**
 * The key of a value's group. Cut as a value on the wire is cut, so two values that share their
 * first `RECIPE_WIRE_LIMITS.text` compared characters share a group: no Board column is that wide.
 */
export function facetKey(value: CellValue | undefined): string {
  return JSON.stringify(comparable(value).slice(0, RECIPE_WIRE_LIMITS.text));
}

/** The key of the group of rows whose value is empty: last on a Board, as "(none)". */
export const EMPTY_FACET = facetKey(null);

/**
 * The groups of `column` over the rows `permutation` names, in this order: the ones `order`
 * names, in its order, matched as values are compared; then the others by first appearance;
 * the empty value last. A word of `order` no row holds draws no group. At most `limit` groups.
 */
export function facetsOf(
  table: Table,
  permutation: readonly number[],
  column: string,
  order: readonly string[] = [],
  limit: number = RECIPE_WIRE_LIMITS.facets,
): Facets {
  const groups = new Map<string, { label: string; count: number }>();
  for (const index of permutation) {
    const value = table.rows[index]?.values[column];
    const key = facetKey(value);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { label: cellText(value), count: 1 });
    else group.count += 1;
  }
  const ordered: string[] = [];
  for (const word of order) {
    const key = facetKey(word);
    if (key !== EMPTY_FACET && groups.has(key) && !ordered.includes(key)) ordered.push(key);
  }
  for (const key of groups.keys()) {
    if (key !== EMPTY_FACET && !ordered.includes(key)) ordered.push(key);
  }
  if (groups.has(EMPTY_FACET)) ordered.push(EMPTY_FACET);
  const facets = ordered.slice(0, limit).map((key) => {
    const group = groups.get(key) ?? { label: '', count: 0 };
    return { key, label: group.label, count: group.count };
  });
  return { facets, more: ordered.length - facets.length };
}

/** The rows of `permutation`, in its order, whose `column` falls in one of the groups `keys`. */
export function rowsInFacets(
  table: Table,
  permutation: readonly number[],
  column: string,
  keys: readonly string[],
): number[] {
  const wanted = new Set(keys);
  return permutation.filter((index) => wanted.has(facetKey(table.rows[index]?.values[column])));
}

/**
 * TYTO-383, the Calendar: rows grouped by the day of a date column, in the run's zone (ADR 0148
 * decision 7, ADR 0177). A day's key is its ISO date, `2026-11-08`; a row with no date is in
 * `NO_DATE`, one whose value names no day in `UNREADABLE_DATE`, so neither is dropped silently.
 */
export const NO_DATE = '';
export const UNREADABLE_DATE = '?';

const MINUTE = 60_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;
/** A written date and time, with or without its offset (`Z`, `-03:00`, `+0100`). */
const ISO_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/iu;
const CLOCK_TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?$/u;

/** Where a row falls on the calendar: its day's key and, when it says one, its wall time. */
export interface DayStamp {
  readonly day: string;
  /** Minutes since the day's midnight on the wall clock. */
  readonly minutes?: number;
}

const pad = (value: number): string => String(value).padStart(2, '0');

function dayKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

function realDay(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  const exists =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return exists ? dayKey(year, month, day) : undefined;
}

/** The wall-clock day and time of an instant in the clock's zone, through a shifted UTC date. */
function wallOf(clock: RunClock, at: Date): DayStamp {
  const wall = new Date(at.getTime() + clock.offsetMinutes(at) * MINUTE);
  return {
    day: dayKey(wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate()),
    minutes: wall.getUTCHours() * 60 + wall.getUTCMinutes(),
  };
}

/**
 * The day a value falls on. A date is its own day in every zone; a time with an offset is an
 * instant, whose day is the wall clock's in `clock`'s zone, so `2026-11-09T01:30Z` is the 8th in
 * São Paulo; a time without one is already wall-clock time. Anything else is unreadable.
 */
export function dayStamp(value: CellValue | undefined, clock: RunClock): DayStamp {
  if (value === undefined || value === null) return { day: NO_DATE };
  if (typeof value !== 'string') return { day: UNREADABLE_DATE };
  const text = value.trim();
  if (text === '') return { day: NO_DATE };
  const date = ISO_DAY.exec(text);
  if (date !== null) {
    return { day: realDay(Number(date[1]), Number(date[2]), Number(date[3])) ?? UNREADABLE_DATE };
  }
  const time = ISO_TIME.exec(text);
  if (time === null) return { day: UNREADABLE_DATE };
  const [, year, month, day, hour, minute, offset] = time;
  const written = realDay(Number(year), Number(month), Number(day));
  if (written === undefined || Number(hour) > 23 || Number(minute) > 59) {
    return { day: UNREADABLE_DATE };
  }
  if (offset === undefined) return { day: written, minutes: Number(hour) * 60 + Number(minute) };
  const instant = Date.parse(text.replace(' ', 'T'));
  return Number.isNaN(instant) ? { day: UNREADABLE_DATE } : wallOf(clock, new Date(instant));
}

/** The wall time a `time=` value says: `HH:MM` as written, or a written time's in the zone. */
export function timeOfDay(value: CellValue | undefined, clock: RunClock): number | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  const clockTime = CLOCK_TIME.exec(text);
  if (clockTime !== null) {
    const hour = Number(clockTime[1]);
    const minute = Number(clockTime[2]);
    return hour > 23 || minute > 59 ? undefined : hour * 60 + minute;
  }
  return ISO_TIME.test(text) ? dayStamp(text, clock).minutes : undefined;
}

/** Today's key on the clock's wall: the day the calendar opens on. */
export function todayIn(clock: RunClock): string {
  return wallOf(clock, clock.now()).day;
}

export interface DayFacets extends Facets {
  /** Dated rows before and after the days asked, which the calendar does not show. */
  readonly earlier: number;
  readonly later: number;
}

const isDay = (key: string): boolean => key !== NO_DATE && key !== UNREADABLE_DATE;

/**
 * The days of `column` over the rows `permutation` names, in date order, then the unreadable
 * group and the undated one. With `days`, only the days from `from` to `to` inclusive, the rows
 * outside counted in `earlier` and `later`; the two undated groups are always there.
 */
export function dayFacetsOf(
  table: Table,
  permutation: readonly number[],
  column: string,
  clock: RunClock,
  days?: { readonly from: string; readonly to: string },
  limit: number = RECIPE_WIRE_LIMITS.facets,
): DayFacets {
  const counts = new Map<string, number>();
  let earlier = 0;
  let later = 0;
  for (const index of permutation) {
    const { day } = dayStamp(table.rows[index]?.values[column], clock);
    if (days !== undefined && isDay(day) && day < days.from) earlier += 1;
    else if (days !== undefined && isDay(day) && day > days.to) later += 1;
    else counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const ordered = [...counts.keys()].filter(isDay).sort();
  for (const key of [UNREADABLE_DATE, NO_DATE]) if (counts.has(key)) ordered.push(key);
  const facets = ordered
    .slice(0, limit)
    .map((key) => ({ key, label: key, count: counts.get(key) ?? 0 }));
  return { facets, more: ordered.length - facets.length, earlier, later };
}

/** A row of a day's page: where the table holds it, and where the calendar draws it. */
export interface DayRow extends DayStamp {
  readonly index: number;
}

/**
 * The rows of `permutation` whose day is one of `keys`, by day, then by time (from `time` when
 * it reads, else the date's own), then in the view's order; a row with no time after the timed
 * ones. With `perDay`, only each day's first rows: what a calendar's day cells draw.
 */
export function rowsInDays(
  table: Table,
  permutation: readonly number[],
  column: string,
  keys: readonly string[],
  clock: RunClock,
  options: { readonly time?: string | undefined; readonly perDay?: number | undefined } = {},
): DayRow[] {
  const wanted = new Set(keys);
  const found: DayRow[] = [];
  for (const index of permutation) {
    const values = table.rows[index]?.values;
    const stamp = dayStamp(values?.[column], clock);
    if (!wanted.has(stamp.day)) continue;
    const minutes =
      (options.time === undefined ? undefined : timeOfDay(values?.[options.time], clock)) ??
      stamp.minutes;
    found.push({ index, day: stamp.day, ...(minutes === undefined ? {} : { minutes }) });
  }
  const late = Number.MAX_SAFE_INTEGER;
  // Days in date order, then the unreadable (a date to fix) and the undated, as the facets are.
  const rank = (day: string): number => (day === UNREADABLE_DATE ? 1 : day === NO_DATE ? 2 : 0);
  // Array#sort is stable: rows of one day and time keep the view's order.
  found.sort((left, right) =>
    left.day === right.day
      ? (left.minutes ?? late) - (right.minutes ?? late)
      : rank(left.day) - rank(right.day) || (left.day < right.day ? -1 : 1),
  );
  const perDay = options.perDay;
  if (perDay === undefined) return found;
  const taken = new Map<string, number>();
  return found.filter((row) => {
    const count = taken.get(row.day) ?? 0;
    taken.set(row.day, count + 1);
    return count < perDay;
  });
}

/** A day row's wall time as the calendar writes it, `09:05`. */
export function clockText(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
