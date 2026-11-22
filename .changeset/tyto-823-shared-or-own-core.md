---
'@tyto/core': minor
---

TYTO-823: a slot declared `per: lamina` may also say `shared: true` (ADR 0225). Written before
the first `::lamina` or in the frontmatter it is every slide's; written after a `::lamina` it is
that slide's own and replaces the shared one there. A `::comum` line closes the slides: a shared
slot after it is every slide's, drawn below each one's own blocks, and a new `::lamina` or a
plain `per` slot after it is `E_BAD_SLOT_VALUE`. A misplaced `::comum`, or one carrying text or
adjustments, is the new `E_BAD_COMUM`. `comum` is reserved as a slot name. A template's context
carries `order`, its artwork's written blocks in drawing order as `{ name, place }`.
