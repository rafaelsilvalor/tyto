---
'@tyto/fonts': minor
'@tyto/core': minor
'@tyto/raster': patch
---

TYTO-484: `@tyto/fonts` bundles Noto Sans Math 400, the symbol face. A glyph a run's face
lacks is measured and drawn, glyph by glyph, in Noto Sans Math and then Source Sans 3: the
split spans enter the IR, so what is measured is what is drawn. `W_GLYPH_MISSING` names a
character no face draws. A code template lists the chain under `faces:` (ADR 0168).
