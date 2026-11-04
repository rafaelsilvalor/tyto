---
'@tyto/core': minor
'@tyto/template-kit': minor
---

TYTO-554: `runsOf` takes bold and italic as a partial style, so bold can change the colour
(a number still means a weight). The kit gains `highlights(spec)` — bold, italic and named
marks as data, varied per place with `.with()` — `highlightsFromValues` for the shared value
names, `richTextOfPlain` for `**…**` and marks in frontmatter text, and `TextStyle.highlights`.
