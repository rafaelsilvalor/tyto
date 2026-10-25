---
'@tyto/recipe': minor
'@tyto/core': minor
'@tyto/plugin-api': patch
---

TYTO-399 (ADR 0139): a recipe run reads time from an injected clock, and the generic verb `age`. `RunOptions` and `VerbContext` take an optional `clock` (`now()` and `offsetMinutes(at)`), the machine's clock and zone by default (`systemClock`), which `run` hands to the recipe it includes and no plugin receives. `age <column> format="dd-MM HH:mm,dd-MM" [year=infer-past] into=<column>` writes the hours since each cell's stamp, in whole minutes over 60, reading the stamp as wall-clock time in the clock's offset with the formats tried in order (tokens dd, MM, yyyy, HH, mm; one or two digits; no time is midnight). A format without yyyy needs `year=infer-past`, which takes the clock's year or the year before, whichever first reads no later than a day after now. An empty cell has no age; one no format reads has none either, counted by one `W_RECIPE_AGE_UNREAD` warning per step, a new code in `@tyto/core`.
