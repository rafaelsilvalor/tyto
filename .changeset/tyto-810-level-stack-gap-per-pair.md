---
'@tyto/template-kit': minor
---

`levelStack` takes a space per pair of neighbours: `lineGap` accepts a function of the items
above and below the gap, and `gap` a function of the two parts of a line around it. A number
keeps today's spacing. `LevelStackStyle` is now a type alias; `lineGap` is required when `gap`
is a function. The new `LevelGap` type names either form (TYTO-810).
