---
'@tyto/core': minor
'@tyto/template-lang': minor
'@tyto/export-html': minor
'@tyto/export-svg': major
'@tyto/cli': patch
'@tyto/desktop': patch
---

Inline SVG markup is refused unless it is flat geometry (TYTO-168, ADR 0068). Nothing used to
sanitise a `Vector` of kind `svg`, though the schema said something did, so two icons exported
from Illustrator — both declaring `.cls-1` — repainted each other in one artwork, and a file
could carry anything else a browser runs.

`@tyto/core` exports `checkSvgMarkup` and `SVG_MARKUP_WAY_OUT`, and `parseScene` refuses markup
outside the subset as the new code `E_SCENE_SVG_MARKUP`, naming the node. The subset is shape
elements (`svg`, `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, plus
`title` and `desc`) painted by presentation attributes, with nothing that names anything: no
`<style>`, `class`, `id`, `<defs>`, `url()` or inline `style`.

`@tyto/template-lang` reports a literal `<vector src>` whose file is outside the subset as
`E_TEMPLATE_MARKUP` on the `src` value, before any brief is written.

`@tyto/export-html` and `@tyto/export-svg` run the same check before they inline, answer
`E_EXPORT_UNSUPPORTED` for a scene that bypassed `parseScene`, and draw nothing for that node.

**Breaking for authors:** a file with a stylesheet, classes, gradients, ids, text, images or
filters used to render and is now an error. Re-export it from Illustrator with Styling set to
Presentation Attributes, draw it as a `kind: 'path'` contour, or place it as a PNG.
