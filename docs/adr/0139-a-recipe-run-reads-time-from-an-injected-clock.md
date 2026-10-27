# 0139 — A recipe run reads time from an injected clock

Status: accepted · 2026-10-25 · TYTO-399 · builds on ADR 0136 and ADR 0137.

## Context

ADR 0136 named `age` among the generic verbs: Buraqueira stamps a task with the time it was
done (`01-10 16:17`, no year) and moves it on 72 hours later. Reading such a stamp needs two
things a pure package cannot assume: what "now" is, and which time zone the stamp was written
in. Buraqueira used `datetime.now()` and naive local time. A recipe that asks the machine
directly cannot be tested against a fixed instant, and a cloud worker in UTC would read a
São Paulo stamp three hours off.

## Decision

1. **The run carries a clock**: `RunClock { now(): Date; offsetMinutes(at: Date): number }`,
   optional in `RunOptions` and in `VerbContext`, the way `resolveData` is (ADR 0137). `run`
   hands it to the recipe it includes, so one run reads one clock. `offsetMinutes` is the
   minutes to add to UTC to reach the wall clock (`-180` in São Paulo), asked per instant so a
   zone with daylight saving answers each date its own.
2. **The default is `systemClock`**: `new Date()` and `-getTimezoneOffset()`, the runtime's
   own zone, read without Node so `@tyto/recipe` stays pure. A host that knows the person's
   zone (a cloud worker, a shared workspace) passes its own.
3. **A written time is wall-clock time in the clock's offset.** `01-10 16:17` is 16:17 on the
   wall in that zone, which is what a person typing it means and what Buraqueira's naive local
   time meant. The offset applied is the one in force at that time read as UTC: exact
   everywhere except the hour a daylight-saving change repeats or skips.
4. **A stamp without a year infers it, and only when told to.** `age` takes
   `year=infer-past`, required when a format lacks `yyyy` and refused when every format has it.
   It tries the clock's year, then the year before, and takes the first in which a format
   matches and which is no later than a day after now. A day of tolerance lets a clock a little
   behind still read today's stamp; a stamp past it belongs to last year (December read in
   January), and `29-02` falls to the leap year that holds it.
5. **An age is hours in whole minutes**: whole minutes elapsed over 60, so 72 hours is exactly
   `72` and `where age >= 72` is Buraqueira's `agora - feito >= timedelta(hours=72)`. It is
   negative within the day of tolerance.
6. **The clock does not cross to plugins.** A contributed verb's request carries its checked
   arguments and the table (ADR 0135), not the context. A plugin that needs time reads its own
   process's, until a card gives the request a clock.

## Consequences

- A test fixes the instant and the zone; `age.test.ts` reads every case at a non-zero offset
  as well as UTC.
- TYTO-401 reuses this clock: the 72-hour hold is `age` with `where age >= 72`, and the month a
  done stamp files under is the stamp read through the same offset and year inference.
- Nothing wires a person's zone yet. Every host today runs on the default, which is the
  machine's; the notebook (TYTO-377) is where a setting for it would land.

## Note, 2026-10-27 — the zone is a setting in the desktop (TYTO-377)

The desktop's notebook reads its clock from the `recipeTimeZone` setting (ADR 0148 decision 7):
an IANA name, or `null` for the machine's zone, which is what every run used before. The offset
is read per instant with `Intl.DateTimeFormat`. The CLI still runs on `systemClock`.
