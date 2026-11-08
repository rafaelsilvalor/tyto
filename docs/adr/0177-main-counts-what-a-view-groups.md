# 0177 — Main counts what a view groups

Status: accepted · 2026-11-07 · TYTO-381 · builds on ADR 0128, ADR 0129, ADR 0146 and ADR 0171

## Context

The Board view (TYTO-381) draws a recipe's rows as cards in one column per value of a field,
each column with how many rows it holds: `show board by=status`. ADR 0148 sends each cell's first
50 rows to the window and keeps the whole table in main, and ADR 0171 made the Table view read
the kept table from main in pages, sorted and filtered there. A board needs more than a page: it
needs every value of a column and how many rows hold each, over a table of up to 50,000 rows,
and the counts must follow the view's quick filter. The Calendar (TYTO-383) groups rows by day
in the same way. Three questions were open:

- Who counts a column's groups, when the window holds 50 rows?
- What makes two values one group, and in which order are the groups drawn?
- Where does a declared order, such as a workspace's status order, come from?

## Decision

1. **Main counts.** A new channel `recipe:facets {documentId, index, ranAt, column, filter?,
columns?, order?}` answers `{facets: [{key, label, count}], total, matched, more}` or
   `{stale}`, counted in main (`src/main/recipe-facets.ts`, pure) over the rows the view's quick
   filter keeps, through the same cached view `recipe:rows` reads (ADR 0171 decision 2). The
   renderer never counts: it draws main's counts. At most `RECIPE_WIRE_LIMITS.facets` (200)
   groups cross; `more` says how many that left out.
2. **Values group as `where` compares them**: no case, no accents, trimmed (`comparable`). A
   group's `key` is the JSON of that compared value, and its `label` the value as its first row
   wrote it, so `Done` and `done` are one column named `Done`. The window hands keys back and
   never reads them.
3. **Order: the declared values first, then first appearance, the empty value last.** The view's
   `order=` names the values placed first, matched as values are compared; a word no row holds
   draws no column. The other groups follow in the order their first row appears in the view.
   The group of rows with no value is last, drawn as "(none)". The order comes only from the
   recipe or a workspace data file, never from code: a company's status graph is configuration
   (AGENTS.md).
4. **A view's `values` argument reads a data file.** `order=@./board.json#/order` is read through
   the host's `resolveData` as every verb's `@./file.json#/pointer` argument is (ADR 0137), and
   must be a list of strings. ADR 0171 left this open; `show` now reads its arguments
   asynchronously.
5. **A group's rows page through `recipe:rows`.** `recipe:rows` gains `facet: {column, keys}`
   (at most 64 keys): only the rows whose value falls in one of those groups, in the view's
   order, with `matched` counting them. A Board column asks for its own, fifty cards at a time.
6. **The Board is view only.** A card is not dragged: changing a status is a step of the recipe
   with its plan (ADR 0129).

## Consequences

- A board of 50,000 rows sends 200 group counts and fifty cards a column, never the table.
- The quick filter changes the counts as it changes the Table's `Rows: N of M`, over the
  columns the board shows (`by=` and `fields=`).
- The Calendar (TYTO-383) adds a day bucketing to `recipe:facets` rather than a channel of its
  own; its zone and its undated rows are its own dated note here.
- Two values that share their first 1,000 compared characters share a group: a group's key is
  cut as a value on the wire is cut.

## Note, 2026-11-08 (TYTO-383): main buckets days too

The Calendar (`show calendar date=… [time=…] [span=week|month]`) groups by day through the same
channels, so **day bucketing also happens in main**; the renderer never reads a date.

- `recipe:facets` takes `bucket: 'day'` and `days: {from, to}`. A row's day is read in pure
  `src/main/recipe-facets.ts`: an ISO date is its own day in every zone; a date and time with an
  offset is an instant, placed on the wall clock of the zone the cell's run read written times
  in (`recipeTimeZone`, ADR 0148 decision 7; the runner keeps the run's clock beside its cells);
  one without an offset is already wall-clock time. Keys are ISO days in date order, then `?`
  (a value that names no day) and `""` (no value), which are always answered, so an undated row
  is listed with its count and never dropped. Rows of dated days outside `days` are counted in
  `earlier` and `later`, and the answer says `today` in the same zone, which the calendar opens
  on. `order` is not read for days.
- `recipe:rows`' `facet` takes `bucket: 'day'`, `time` and `perDay`: the rows of the days asked,
  by day, then by the wall time `time=` names (`HH:MM` or a date and time), else the date's own,
  each row with its `day` and `time`. One page with `perDay: 3` fills a month's 42 cells; "+k
  more" asks for one day's rest.
- The first weekday is the window language's (`Intl.Locale#getWeekInfo`), Monday when the
  engine says nothing. The Calendar is view only, as the Board is (decision 6).

## Note, 2026-11-08 (TYTO-384): a card opened reads its row from main

The Cards view (`show cards [fields=…]`, the first four columns when absent) pages its grid
through `recipe:rows` with `columns` set to `fields=`, as a Board column does, and adds one
channel: **`recipe:row {documentId, index, ranAt, key}`** answers one row whole, every column the
table has (up to `RECIPE_WIRE_LIMITS.columns`) whatever `fields=` a card shows, and the row's
provenance `{source, id, fetchedAt}`; or `stale` when the cell ran again or no longer holds the
key.

- An opened card is read whole, so its values are cut at `RECIPE_WIRE_LIMITS.opened` = 10,000
  characters instead of the preview's 1,000; names and provenance stay at 1,000.
- `Provenance` carries no address, and changing that contract is out of scope. The card's link
  is the first `link` column whose value `externalUrlAllowed` accepts; a `file:` or custom-scheme
  value is drawn as text, never an anchor.
- A row made by `group` shows `group` as its source and the group's key as its id, as
  `Provenance` already says.
- The opened card is drawn in the window's dialog frame (a scrim, `role="dialog"`,
  `aria-modal`), and Escape closes it. View only (decision 6).
