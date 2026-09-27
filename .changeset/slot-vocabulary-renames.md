---
'@tyto/templates': minor
---

TYTO-157: the built-in templates use the standard slot vocabulary (`docs/slot-vocabulary.md`). **Briefs written against the previous versions must be edited**: `promo-curso` 2.0.0 renames `cor` to `tom`; `carrossel-lista` 2.0.0 renames `item` to `lamina`; `agenda-semana` 3.0.0 renames `ilustracao` to `imagem` and `slide` to `lamina`; `aprovados` 2.0.0 renames `emblema` to `imagem`. An old name is reported as `E_UNKNOWN_SLOT` on its line. The pixels are unchanged; exported files and SVG element ids of the two carousel templates are now named `lamina-N` instead of `item-N` and `slide-N`.
