---
'@tyto/export-html': minor
'@tyto/core': minor
---

Export a `Scene` to one self-contained HTML document per frame (TYTO-27)

`@tyto/export-html` is now a full `SceneVisitor`: transforms, opacity, blend modes, clip,
masks, shadows and blurs, text as spans with `<br>` between the lines, images, vectors and
frame backgrounds. Fonts and images arrive as bytes through `HtmlResources` and are
embedded, so the document opens with no network and the same scene renders the same
pixels every time. `exportHtml(scene, options)` does the whole scene, `exportFrameHtml`
one frame.

The output nests, so each element carries only `nodeMatrix(node)` and the browser composes
the rest — which is what keeps a group's opacity, blend mode and mask meaning what the IR
says they mean. Per-node styling lands in the document's stylesheet under an escaped
`#id`, because a mask is a whole SVG document inside a `url()`.

ADR 0018 records the four questions the IR left open that a visitor cannot avoid: `clip`
on a group is ignored (a group has no box to clip to), a radial gradient's `radius` is a
fraction of the node's box on both axes, a shadow's `spread` is reported where the format
has no equivalent, and bytes reach an exporter through a resolver rather than a path.

`@tyto/core` gains `invertMatrix`, `nodeMatrix` and `anchorBox` — an exporter that nests
needs a node's own matrix, and one that draws a mask in another node's coordinates needs
the inverse — plus `E_EXPORT_ASSET_UNRESOLVED`, `E_EXPORT_FONT_UNRESOLVED`,
`E_EXPORT_UNSUPPORTED` and `W_EXPORT_APPROXIMATED`.
