/**
 * The run's clock (ADR 0139): what "now" is, and the offset a written time is wall-clock time
 * in. Injected, so a test reads a stamp against a fixed instant and a host can pin the zone.
 */
export interface RunClock {
  now(): Date;
  /**
   * Minutes to add to UTC to reach the wall clock at `at`: `-180` in São Paulo, `60` in Lisbon
   * in summer. Asked per instant, so a zone with daylight saving answers each date its own.
   */
  offsetMinutes(at: Date): number;
}

/**
 * The machine's clock and time zone, the default when a host gives none. `getTimezoneOffset`
 * counts the other way (minutes from local time to UTC), hence the minus; it reads the zone
 * without Node, which this package may not import.
 */
export const systemClock: RunClock = {
  now: () => new Date(),
  offsetMinutes: (at) => -at.getTimezoneOffset(),
};

const MINUTE = 60_000;

/** The fields of the wall clock at `at`, read through a UTC date shifted by the offset. */
export function wallClock(clock: RunClock, at: Date): Date {
  return new Date(at.getTime() + clock.offsetMinutes(at) * MINUTE);
}

/**
 * The instant a wall-clock time names, its fields given as a UTC timestamp. The offset is the
 * one in force at that time read as UTC, which is exact everywhere except the hour a daylight
 * saving change repeats or skips.
 */
export function instantOf(clock: RunClock, wall: number): Date {
  return new Date(wall - clock.offsetMinutes(new Date(wall)) * MINUTE);
}
