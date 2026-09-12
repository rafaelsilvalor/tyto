# @tyto/export-html

## 0.3.4

### Patch Changes

- Updated dependencies [a40f4d9]
  - @tyto/core@0.16.0
  - @tyto/plugin-api@0.2.4

## 0.3.3

### Patch Changes

- Updated dependencies [04c076c]
  - @tyto/core@0.15.0
  - @tyto/plugin-api@0.2.3

## 0.3.2

### Patch Changes

- Updated dependencies [15dfa8b]
  - @tyto/core@0.14.1
  - @tyto/plugin-api@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [2f72340]
  - @tyto/core@0.14.0
  - @tyto/plugin-api@0.2.1

## 0.3.0

### Minor Changes

- 81026df: Line boxes now use the face the node embeds, not the browser's default.

  A text node carried `line-height` but declared no font, so its block strut came from the
  document default — Times New Roman at 16px — and decided the leading whenever it was
  taller than the runs. A node asking for `lineHeight: 1.45` over a single 15px run laid out
  at 23.75px per line instead of 21.75. The node now also carries `font-family`, `font-size`
  and `font-weight`, taken from its largest run, which is what `docs/ir-schema.md` means by
  "a multiplier of the run's font size".

  Every multi-line text whose runs are smaller than roughly 16px moves. That is the leading
  the IR asked for arriving, not a regression, but it does change rendered output: pre-1.0,
  a minor.

## 0.2.0

### Minor Changes

- 607f8e1: TYTO-34 — the plugin host, and the first two built-ins that go through it.

  `@tyto/plugin-api` gains the nine contribution types of `docs/plugin-api.md` and
  `createPluginHost`: an in-process registry with `register*`, `config`, `log`, `events` and a
  `Disposable` per contribution. Pure — it is maps and disposables, and every capability
  arrives from the composition root. `source`, `sink` and `rasterizer` are typed generically
  because their ports are declared in Node packages and this one may not name them (ADR 0010);
  the host stores the value and only reads its id.

  **`runJob` no longer imports an exporter.** It takes `ports.exporters`, asks
  `forKind(kind)`, and branches on the exporter's own `rasterized` flag instead of on
  `kind === 'svg'`. `JobPorts.resources` and the `JobResources` type are gone: what an
  exporter needs for a font or an image now binds when it is registered, which keeps the
  extension point out of the `HtmlFontFace` versus `SvgFontFace` argument that belongs to
  TYTO-62. A new ESLint rule, `boundary/pipeline-has-no-exporters`, keeps it that way — the
  one `eslint.config.js` said would land with E7.1.

  **`OutputRequest` is one shape rather than a union per kind.** It used to say in the type
  which options belong to which exporter, which is the knowledge an extension point takes away
  from the job. An exporter reads what it understands; the rasterizer port still refuses
  `quality` on a PNG where it can actually check.

  `@tyto/export-html` and `@tyto/export-svg` each export their own plugin —
  `htmlExporterPlugin(...)`, `svgExporterPlugin(...)` — so a built-in ships with the thing it
  plugs in and the CLI, the desktop app and every test reach it through one factory. `@tyto/io`
  gains `ExportResources`, the type `JobResources` used to be: it describes bytes read off a
  disk, which is this package's subject and no longer the job's.

  Nothing renders differently. The same briefs produce the same bytes; what changed is which
  module hands them over.

### Patch Changes

- Updated dependencies [607f8e1]
  - @tyto/plugin-api@0.2.0

## 0.1.3

### Patch Changes

- Updated dependencies [e994ca9]
  - @tyto/core@0.13.0

## 0.1.2

### Patch Changes

- Updated dependencies [3a782b3]
  - @tyto/core@0.12.0

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
