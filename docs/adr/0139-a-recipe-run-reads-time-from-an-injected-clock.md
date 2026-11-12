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

## Note, 2026-11-12 — a template writes an instant in the run's zone (TYTO-675)

A tracker returns datetimes in UTC. Converting the hour alone through a table left a delivery
at 22:00 in São Paulo on the next day, since the date did not move back with it. A template
filter, not a verb, reads such a column: `{due|local:yyyy-MM-dd}`, `{due|local:HH:mm}`,
`{due|local:dd/MM/yyyy HH:mm}`, wherever a recipe template is filled (`compose`, a `rules`
table's `set`, a `call` body). A filter keeps the conversion inside the one template that
writes the cell, with no intermediate column.

- **The format** uses the tokens `age format=` reads (dd, MM, yyyy, HH, mm, each at most once,
  any other character literally); none is required, so `HH:mm` alone is a format. A letter
  outside a token is refused with `E_RECIPE_TEMPLATE` at the template, before any row is read.
- **The input** is an ISO-8601 instant with its date, its time to the minute and a zone: `Z`,
  `±HH:mm` or `±HHmm`; seconds and fractions may follow the minutes. A date alone or a time
  without a zone names no instant and is not guessed. A cell that is not one is written empty
  and counted by one `W_RECIPE_LOCAL_UNREAD` warning per column and step; an empty cell stays
  empty and is not counted.
- **The zone.** `RunClock` gains an optional `timeZone`, an IANA name. When the host gives one,
  the wall clock is read with `Intl.DateTimeFormat` in that zone, which carries its
  daylight-saving rules; the desktop's clock names the zone of the `recipeTimeZone` setting, or
  the machine's when the setting is `null`. When it gives none (`systemClock`, the CLI, a test
  clock), the wall clock is the instant plus `offsetMinutes(at)` for that instant. A name the
  runtime does not know falls back to the offsets, since the host checks the name first.
