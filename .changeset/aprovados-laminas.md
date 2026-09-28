---
'@tyto/templates': major
---

TYTO-190: `aprovados` 3.0.0 runs across several slides. Each `::lamina` is one slide and holds its specialties and `rank | name` rows; the title block (imagem, chamada, subtitulo, titulo) is drawn on the first slide only, and the arrow on every slide but the last. **Briefs must be edited**: `::lista` becomes `::lamina`, and an old `::lista` is reported as `E_UNKNOWN_SLOT`. One `::lamina` with the old list renders the same pixels as 2.0.0.
