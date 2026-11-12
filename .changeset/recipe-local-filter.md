---
'@tyto/recipe': minor
'@tyto/core': minor
'@tyto/desktop': patch
---

TYTO-675 (ADR 0139 note of 2026-11-12): a recipe template writes an ISO-8601 instant as
wall-clock time in the run's zone with the filter `local:<format>`, as in
`compose day="{due|local:yyyy-MM-dd}"` or `{due|local:dd/MM/yyyy HH:mm}`, so a delivery at
22:00 in São Paulo stays on its day. The format takes the tokens `age format=` reads (dd, MM,
yyyy, HH, mm); a letter outside a token is refused with `E_RECIPE_TEMPLATE`. `RunClock` gains
an optional IANA `timeZone`: with it the wall clock is read through `Intl.DateTimeFormat`, with
its daylight-saving rules; without it through `offsetMinutes`. The desktop's clock names the
zone of the `recipeTimeZone` setting. A cell that is not an instant with `Z` or an offset is
written empty and counted by the new warning `W_RECIPE_LOCAL_UNREAD` in `@tyto/core`.
