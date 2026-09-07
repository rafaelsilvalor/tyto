---
'@tyto/core': minor
---

Add `defineTemplate`, `runsOf` and the `compile` stage.

`compile(resolved, template)` expands the repeatable slot into one `Artwork` per
occurrence, calls the template once per (artwork, format), collects the fonts and assets
the resulting scene reached for, and validates the whole thing with `parseScene`. Nothing
a template throws escapes: a `TemplateError` surfaces the diagnostic it built and anything
else becomes `E_TEMPLATE_CRASH` (ADR 0014).

`defineTemplate(manifest, build)` pairs a manifest with that function. Its context carries
the format, the artwork's id, index and count, every slot with the repeatable one already
resolved to this artwork, that artwork's adjustments, and an `idPrefix` a template must
pass to `frame()` — it carries both the artwork and the format, because either alone
collides.

`runsOf(text, style, options)` turns the rich text of a brief into `TextRun[]`: bold
becomes a weight, italic a style, a `Break` a `LineBreak` run (ADR 0016), and a mark
whatever the template maps it to.
