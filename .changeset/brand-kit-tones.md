---
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/templates': minor
---

TYTO-230: a brand kit's logo may be toned layers — `{ box, layers: [{ tone, d, fillRule }] }`, with `tone` `primary` or `secondary` and still no colour — as well as one `MarkShape`, which keeps working as all `primary`; and a kit may carry a `wordmark` under the same rules (ADR 0066). A mark's paths together are bounded by `MARK_PATH_LIMIT`, and a toned mark has at most `MARK_LAYER_LIMIT` (16) layers. The isolation protocol is now version 4. The built-in templates map each tone to a colour of their own, and `banner-roxo` draws the kit's wordmark in its square format; without a kit their output is unchanged.
