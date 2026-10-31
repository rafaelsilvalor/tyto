---
'@tyto/core': patch
'@tyto/export-html': patch
'@tyto/export-svg': patch
'@tyto/raster': patch
---

A shadow's blur and a layer blur are the Gaussian's standard deviation everywhere, as CSS
`drop-shadow()` and `blur()` already read them (ADR 0156, 2026-10-31 note). `export-svg`
and the spread filter in `export-html` no longer halve it, so the SVG and a spread shadow
draw what the HTML and the PNG drew; no PNG of a shadow without a spread changes.
`export-svg` gives a filter the frame plus three deviations of room instead of a fixed
margin of the node, which cut a wide blur off a small node. The raster suite compares
the HTML and SVG renders of a shadow, a spread and a blur.
