import { describe, expect, it } from 'vitest';

import { recipeClock, zoneClock } from './recipe-clock.js';

/**
 * The clock a recipe run reads (TYTO-377, ADR 0139, ADR 0148): the offset of the zone the
 * `recipeTimeZone` setting names, per instant, across a daylight-saving change.
 */
describe('a clock in a named zone', () => {
  it('answers each instant its own offset across a daylight-saving change', () => {
    // Europe/Lisbon left summer time at 01:00 UTC on 2026-10-25: +60 before, 0 after.
    const lisbon = zoneClock('Europe/Lisbon');
    expect(lisbon.offsetMinutes(new Date('2026-10-25T00:59:00.000Z'))).toBe(60);
    expect(lisbon.offsetMinutes(new Date('2026-10-25T01:00:00.000Z'))).toBe(0);
    // New York, a week later: -240 before 06:00 UTC on 2026-11-01, -300 after.
    const york = zoneClock('America/New_York');
    expect(york.offsetMinutes(new Date('2026-11-01T05:59:00.000Z'))).toBe(-240);
    expect(york.offsetMinutes(new Date('2026-11-01T06:00:00.000Z'))).toBe(-300);
    // São Paulo has kept no daylight saving since 2019, and a zone off by a half hour is exact.
    expect(zoneClock('America/Sao_Paulo').offsetMinutes(new Date('2026-01-15T12:00:00Z'))).toBe(
      -180,
    );
    expect(zoneClock('Asia/Kolkata').offsetMinutes(new Date('2026-10-27T12:00:00Z'))).toBe(330);
  });

  it('reads now from what it is handed', () => {
    const fixed = new Date('2026-10-27T12:00:00.000Z');
    expect(zoneClock('UTC', () => fixed).now()).toBe(fixed);
  });

  it("follows the setting, and is this machine's zone when the setting is null", () => {
    const at = new Date('2026-07-01T12:00:00.000Z');
    expect(recipeClock('Asia/Kolkata').offsetMinutes(at)).toBe(330);
    expect(recipeClock('America/Sao_Paulo').offsetMinutes(at)).toBe(-180);
    expect(recipeClock(null).offsetMinutes(at)).toBe(-at.getTimezoneOffset());
  });
});
