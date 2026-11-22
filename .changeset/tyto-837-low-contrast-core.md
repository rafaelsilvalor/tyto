---
'@tyto/core': minor
---

TYTO-837: a template may report `W_TEMPLATE_LOW_CONTRAST` with two hex colours it draws text in
and the WCAG 2 ratio between them, a warning that keeps the colours. `contrastRatio(a, b)` and
`relativeLuminance(hex)` in `@tyto/core/template` measure it the same way for every template.
