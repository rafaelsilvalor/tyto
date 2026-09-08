---
'@tyto/template-lang': minor
'@tyto/core': minor
---

Parse `template.html` into a template function (TYTO-24)

`@tyto/template-lang` now has its own Lezer grammar for the HTML-like markup and
`compileTemplate(source, { manifest, assets })`, which returns the same `Template` a
`template.ts` exports — so `compile` cannot tell the two authoring paths apart. The markup
path additionally reports `renderedSlots`, which is what `resolve` needs to emit
`W_UNUSED_SLOT`.

Three contradictions inside `docs/template-authoring.md` are settled in the same pass:
`content: slot(…)` is gone (`slot="x"` is the only way to draw a slot), `bg` and `format`
join the frame's accepted attributes, and `@each <slot>` is documented as a scope rather
than a loop.

`@tyto/core` gains `E_UNSUPPORTED_TAG`, `E_UNSUPPORTED_ATTRIBUTE` and `E_TEMPLATE_MARKUP`,
and exports `didYouMean`/`editDistance` — `resolve` and the template parser both need the
same suggestion budget.
