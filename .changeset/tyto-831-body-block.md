---
'@tyto/template-kit': minor
---

TYTO-831: `bodyBlock` draws a body, the lines of general information under a title, as one block
of its own (ADR 0224): it reads the levels (`|`, `#` to `###`, `---`), takes the area's width and
a scale, and enters a `blockColumn` as an entry with its own `peso`. A line with no mark is drawn
smaller than every marked level: the smallest marked size times `unmarkedRatio` (0.8 by default,
`bodySize`). Its numbers are declared in `BODY_PARAMETERS`.
`bodyBlock` takes the body's words and reads them with `levelsOf(text, { readByPosition: false })`,
the new option that keeps a first line with no mark at the base level instead of reading it as a
name.
