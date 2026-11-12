import { type Diagnostic, type SourceRange, diagnostic } from '@tyto/core';

import { formatStamp } from './age.js';
import { type RunClock, systemClock, wallClock } from './clock.js';

/**
 * `{column|local:<format>}` (TYTO-675, ADR 0139 note of 2026-11-12): an ISO-8601 instant, such
 * as the `2026-11-12T01:30:00Z` a tracker returns, written as wall-clock time in the run's
 * zone with the tokens `age format=` reads. Converting the hour alone is what moved a delivery
 * at 22:00 in São Paulo to the next day; this reads the whole wall clock, so the date rolls
 * back with the hour.
 */

const MINUTE = 60_000;

/**
 * An instant with its date, its time to the minute and a zone: `Z`, `±HH:mm` or `±HHmm`
 * (Jira writes the last). Seconds and fractions may follow the minutes. A date alone, or a
 * time without a zone, names no instant and is refused rather than guessed.
 */
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:(Z)|([+-])(\d{2}):?(\d{2}))$/iu;

/** The instant `text` names, or none when it is not an ISO-8601 instant with a zone. */
export function readInstant(text: string): Date | undefined {
  const match = INSTANT.exec(text);
  if (match === null) return undefined;
  const number = (group: number) => Number(match[group] ?? '0');
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map(number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const exists =
    wall.getUTCFullYear() === year && wall.getUTCMonth() === month - 1 && wall.getUTCDate() === day;
  if (!exists) return undefined;
  if (match[7] !== undefined) return wall;
  const zoneHours = number(9);
  const zoneMinutes = number(10);
  if (zoneHours > 23 || zoneMinutes > 59) return undefined;
  const offset = (match[8] === '-' ? -1 : 1) * (zoneHours * 60 + zoneMinutes);
  return new Date(wall.getTime() - offset * MINUTE);
}

/**
 * Reads an instant's wall clock in the clock's zone, as the fields of a UTC date. With an IANA
 * `timeZone`, through `Intl.DateTimeFormat`, which carries the zone's daylight-saving rules;
 * without one, or with a name the runtime does not know, through `offsetMinutes`.
 */
function wallReader(clock: RunClock): (instant: Date) => Date {
  const zone = clock.timeZone;
  if (zone === undefined) return (instant) => wallClock(clock, instant);
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    // A host checks the name before it builds the clock (ADR 0148); one that did not still
    // gets an answer, from the offsets it gave.
    return (instant) => wallClock(clock, instant);
  }
  return (instant) => {
    const parts = new Map(format.formatToParts(instant).map((part) => [part.type, part.value]));
    const field = (type: Intl.DateTimeFormatPartTypes) => Number(parts.get(type));
    return new Date(
      Date.UTC(field('year'), field('month') - 1, field('day'), field('hour'), field('minute')),
    );
  };
}

/**
 * The `local` filter of one step: it writes with the step's clock and counts, per column, the
 * cells that held text and no instant. The step reports them as one warning per column, at
 * the template that read them.
 */
export interface LocalTime {
  write(text: string, format: string, column: string): string;
  warnings(range: SourceRange): Diagnostic[];
}

export function localTime(clock: RunClock = systemClock): LocalTime {
  const wallOf = wallReader(clock);
  const unread = new Map<string, number>();
  return {
    write(text, format, column) {
      const trimmed = text.trim();
      if (trimmed === '') return '';
      const instant = readInstant(trimmed);
      if (instant === undefined) {
        unread.set(column, (unread.get(column) ?? 0) + 1);
        return '';
      }
      return formatStamp({ text: format }, wallOf(instant));
    },
    warnings(range) {
      return [...unread].map(([column, count]) =>
        diagnostic('W_RECIPE_LOCAL_UNREAD', { count, column }, { range }),
      );
    },
  };
}
