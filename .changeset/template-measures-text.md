---
'@tyto/core': minor
'@tyto/template-lang': patch
'@tyto/templates': patch
---

TYTO-162: a template can ask how big a text node will be before it places it (ADR 0038).

`TemplateContext.measure(node)` returns the `TextMeasurement` — lines, width, height — that
`compile` will lay the node out at, from the same `measureText` over the same faces, or
`undefined` when nothing can measure. `measureNothing` is the answer for a context with no faces.
`measureText` accepts a node without an id (`MeasurableText`), so a template measures the draft it
is about to place.

**Breaking for anyone who builds a `TemplateContext` by hand**: `measure` is now required.
