---
'@tyto/export-html': patch
---

A shadow's `spread` is drawn instead of dropped with a warning (TYTO-483, ADR 0156). The document carries an inline SVG `<filter>` with the primitives `export-svg` draws a spread with, and the CSS filter list names it, so the HTML, the raster and the SVG export draw the same shadow on any node — a rect, a path, a group, or a translucent fill. A shadow with no spread keeps `drop-shadow()`, and its output is unchanged.
