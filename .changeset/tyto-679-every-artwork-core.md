---
'@tyto/core': minor
---

TYTO-679: a template's context carries `artworks`, every artwork of the brief in order with its
adjustments (ADR 0203), so a slide can tell where it stands: a bare `{continua}` after an answer
can stay an answer. Adjustments only, aligned with `artwork.index`, and optional on the type.
