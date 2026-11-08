---
'@tyto/desktop': minor
---

The recipe notebook draws `show calendar date=<column> [time=<column>] [span=week|month]` as a
Calendar (TYTO-383, ADR 0177 note of 2026-11-08): each row on the day its date falls on in the
run's time zone (`recipeTimeZone`), a day's rows by time, three to a day and "+k more". It opens
on the week or month holding today, with Previous and Next, Week and Month, and how many dated
rows lie before and after the span. Rows with no date, or a date that names no day, are listed
apart as "No date (N)". The first weekday is the window language's. View only. Main counts the
days: `recipe:facets` gains `bucket: 'day'` and `days`, and `recipe:rows`' `facet` gains
`bucket`, `time` and `perDay`.
