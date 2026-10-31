---
'@tyto/export-html': patch
'@tyto/export-svg': patch
'@tyto/raster': patch
---

Every filter `export-html` and `export-svg` write interpolates in sRGB, so a shape under a
shadow keeps its exact fill colour. In linearRGB, the default, the spread filter and
`export-svg`'s `feDropShadow` handed the shape back shifted (#081c3d drawn #0d1c3d)
(ADR 0156, 2026-10-31 note). The raster suite checks the interior of a shadowed shape
against its fill in the HTML and SVG renders.
