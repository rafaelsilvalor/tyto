import type { RunClock } from '@tyto/recipe';

/**
 * The clock a recipe run reads in the window (TYTO-377, ADR 0139, ADR 0148): now from this
 * machine, and the offset of the zone the `recipeTimeZone` setting names, asked per instant so
 * a zone with daylight saving answers each date its own.
 *
 * `Intl.DateTimeFormat` and not a table of offsets: the runtime carries the IANA database, and
 * a zone's rules change by law more often than Tyto ships.
 */

const MINUTE = 60_000;

/**
 * A clock in `zone`, an IANA name such as `America/Sao_Paulo`. `now` is injected so a test
 * fixes the instant; the app passes the machine's.
 *
 * Throws `RangeError` for a name the runtime does not know: the setting's schema refuses one
 * first (`isTimeZone` in `shared/settings.ts`), so reaching it is a caller's mistake.
 */
export function zoneClock(zone: string, now: () => Date = () => new Date()): RunClock {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return {
    now,
    offsetMinutes(at) {
      const parts = new Map(format.formatToParts(at).map((part) => [part.type, part.value]));
      const field = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.get(type));
      // The wall clock's fields read as if they were UTC, minus the instant itself: the
      // offset. Seconds are dropped on both sides, since no zone in use is off by seconds.
      const wall = Date.UTC(
        field('year'),
        field('month') - 1,
        field('day'),
        field('hour'),
        field('minute'),
      );
      const instant = Math.floor(at.getTime() / MINUTE) * MINUTE;
      return Math.round((wall - instant) / MINUTE);
    },
  };
}

/**
 * The clock for the setting's value: the zone it names, or the machine's own when it is `null`
 * (the default), which is `systemClock`'s answer read through the same code.
 */
export function recipeClock(zone: string | null, now?: () => Date): RunClock {
  const machine = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zoneClock(zone ?? machine, now);
}
