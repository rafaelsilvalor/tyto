/**
 * The Calendar view's arithmetic (TYTO-383, ADR 0177), apart from the DOM so it is tested alone.
 *
 * The calendar never reads a date: main says which day each row falls on in the run's zone and
 * how many rows each day holds (`recipe:facets` with `bucket: 'day'`). What is left here is the
 * grid: which days a week or a month shows, where it starts, and how many rows a day leaves out.
 * Days are ISO keys (`2026-11-08`), counted as UTC dates so no zone moves them.
 */

import type { ViewOption } from './recipe-board-model.js';

export type CalendarSpan = 'week' | 'month';

export interface CalendarOptions {
  /** The column whose day places a row. */
  readonly date: string;
  /** The column whose wall time orders a day's rows. */
  readonly time: string | undefined;
  /** The span the calendar opens on. */
  readonly span: CalendarSpan;
  /** The column a row is named by: the first besides `date` and `time`. */
  readonly title: string | undefined;
}

/** Rows a day cell draws before "+k more". */
export const DAY_ROWS = 3;

/** Undated rows the "No date" list draws a page at a time. */
export const UNDATED_PAGE = 50;

/** The two groups of rows with no day: no date, and a date that names no day. */
export const NO_DATE = '';
export const UNREADABLE_DATE = '?';

/** The calendar `show calendar` asked for, or `undefined` without `date=` (an unchecked recipe). */
export function calendarOptions(
  options: Readonly<Record<string, ViewOption>>,
  columns: readonly string[],
): CalendarOptions | undefined {
  const date = options['date'];
  if (typeof date !== 'string') return undefined;
  const time = typeof options['time'] === 'string' ? options['time'] : undefined;
  return {
    date,
    time,
    span: options['span'] === 'week' ? 'week' : 'month',
    title: columns.find((name) => name !== date && name !== time),
  };
}

/** The columns every calendar query names, so the quick filter matches over what it shows. */
export function calendarColumns(calendar: CalendarOptions): string[] {
  return [calendar.title, calendar.date, calendar.time].filter(
    (name): name is string => name !== undefined,
  );
}

const DAY = 86_400_000;

function parse(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

function keyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The day `count` days after `key`, or before it for a negative count. */
export function addDays(key: string, count: number): string {
  return keyOf(new Date(parse(key).getTime() + count * DAY));
}

/** The day's weekday as `Intl.Locale#getWeekInfo` numbers it: 1 Monday to 7 Sunday. */
export function weekdayOf(key: string): number {
  const day = parse(key).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Today on this machine's wall clock: the first guess, which main's `today` corrects. */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${String(now.getFullYear())}-${month}-${day}`;
}

interface WeekInfoLocale {
  getWeekInfo?: () => { firstDay?: number };
  weekInfo?: { firstDay?: number };
}

/**
 * The weekday a week starts on in `locale`, 1 Monday to 7 Sunday, from `Intl.Locale#getWeekInfo`
 * (`weekInfo` in older engines); Monday, ISO's, when the engine says nothing.
 */
export function firstWeekday(locale: string): number {
  try {
    const known = new Intl.Locale(locale) as unknown as WeekInfoLocale;
    const firstDay = known.getWeekInfo?.().firstDay ?? known.weekInfo?.firstDay;
    return firstDay !== undefined && firstDay >= 1 && firstDay <= 7 ? firstDay : 1;
  } catch {
    return 1;
  }
}

/** The first day of the week holding `key`, weeks starting on `firstDay`. */
export function weekStart(key: string, firstDay: number): string {
  return addDays(key, -((weekdayOf(key) - firstDay + 7) % 7));
}

/**
 * The days a span shows around `anchor`: its week, or the six weeks from the week holding the
 * first of its month, 42 days, as a wall calendar draws a month.
 */
export function spanDays(anchor: string, span: CalendarSpan, firstDay: number): string[] {
  const start = weekStart(span === 'week' ? anchor : `${anchor.slice(0, 8)}01`, firstDay);
  return Array.from({ length: span === 'week' ? 7 : 42 }, (_, index) => addDays(start, index));
}

/** The anchor of the span before (`-1`) or after (`1`) the one holding `anchor`. */
export function shiftAnchor(anchor: string, span: CalendarSpan, direction: -1 | 1): string {
  if (span === 'week') return addDays(anchor, 7 * direction);
  const first = parse(`${anchor.slice(0, 8)}01`);
  first.setUTCMonth(first.getUTCMonth() + direction);
  return keyOf(first);
}

/** Whether a day of a month's grid lies in the month itself, not the weeks around it. */
export function inMonth(key: string, anchor: string): boolean {
  return key.slice(0, 7) === anchor.slice(0, 7);
}

/** How many of a day's rows its cell leaves out: what "+k more" says. */
export function hiddenRows(count: number, drawn: number): number {
  return Math.max(0, count - drawn);
}
