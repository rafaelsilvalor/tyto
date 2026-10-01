---
'@tyto/cli': patch
---

TYTO-215: `tyto render --types svg` crops a `cover` image the way the window does. The CLI now
hands the SVG exporter each picture's own size (brief's files first, the template's second), so
the image is drawn with an explicit transform and a `clipPath` instead of
`preserveAspectRatio="… slice"`. For the same brief, the CLI's and the window's SVGs are
byte-identical again. HTML and raster output are unchanged.
