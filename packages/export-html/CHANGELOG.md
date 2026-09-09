# @tyto/export-html

## 0.1.1

### Patch Changes

- 88235a9: Draw an image paint in the node's own box (TYTO-28)

  Both exporters wrote an image paint's `<pattern>` in `objectBoundingBox` units, where the
  image's viewport is the unit **square**: `preserveAspectRatio` fitted the picture to a
  square, and the square was then stretched to the node's box. On anything that is not
  square the aspect ratio was destroyed — a `cover` image on a 1080×1920 frame came out with
  a circle rendered as an ellipse.

  Both now write the pattern in user space with the node's real box, which is what makes
  `cover` mean cover.

  Found by rendering the same scene through both exporters in Chrome and counting pixels:
  **972151 of 2073600 differed** on the story frame, and **0** do now. The two remaining
  differences between the exporters are the documented ones — text placement (ADR 0019) and
  stroke alignment (ADR 0018).

## 0.1.0

### Minor Changes

- 192d674: Export a `Scene` to one self-contained HTML document per frame (TYTO-27)

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

### Patch Changes

- Updated dependencies [192d674]
  - @tyto/core@0.11.0
