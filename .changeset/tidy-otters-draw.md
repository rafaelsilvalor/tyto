---
'@tyto/export-svg': minor
---

Export a `Scene` to one SVG document per frame (TYTO-28)

`@tyto/export-svg` is now a full `SceneVisitor`: `<g>` per node with its own matrix,
opacity and blend mode, `<mask>` and `<clipPath>`, `<filter>` for shadows and blurs,
gradients and image paints as `<linearGradient>`, `<radialGradient>` and `<pattern>`,
images as data URIs, inline SVG files nested at the node's size, and text as `<text>` with
one positioned `<tspan>` per line. Fonts are embedded as `@font-face` in an inline
`<style>`. `exportSvg(scene, options)` does the whole scene, `exportFrameSvg` one frame.

Two things are exact here that `export-html` has to approximate: a stroke's `align`
(`inside` is clipped to the shape, `outside` masked to everything but it) and a shadow's
`spread` (`feMorphology` before the blur, where CSS `drop-shadow()` has no room for one).
The short `feDropShadow` is used whenever the spread is zero, because it is the form design
tools read most reliably.

`textAsPaths` draws every run as glyph outlines instead, for a document that depends on no
font. The outlines come from `resources.outline`, a port: the package is pure and owns no
font parser, and asking for the flag without a resolver is `E_EXPORT_UNSUPPORTED` rather
than an SVG that quietly still contains `<text>`.

ADR 0019 records what SVG cannot do and what was approximated instead. The load-bearing
one: **an SVG does not wrap.** SVG has no line box, so until E4.5 measures text the lines
are exactly the brief's `LineBreak` runs, and a paragraph that wraps in the HTML export
runs past its box here. A baseline sits at an approximated ascent, kept as one named
constant so a measured one is a single edit.
