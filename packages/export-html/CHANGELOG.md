# @tyto/export-html

## 0.6.1

### Patch Changes

- Updated dependencies [8b24969]
  - @tyto/core@0.24.0
  - @tyto/plugin-api@0.3.7

## 0.6.0

### Minor Changes

- 80a03a8: TYTO-116 — the three codes ADR 0025 held fatal because skipping them left a hole nothing in
  the artwork named are non-fatal, and what makes that safe is that the hole is now drawn
  (ADR 0035). `E_MISSING_REQUIRED_SLOT`, `E_EXPORT_ASSET_UNRESOLVED` and
  `E_EXPORT_UNSUPPORTED` still fail a build; they no longer cancel the picture.

  **One description of the mark, in `packages/core/src/scene/gap.ts`.** Magenta, in two forms
  because the two stages that meet a hole draw in different alphabets: `gapStampNode` is IR, an
  inside-aligned stroke the size of the frame that `compile` appends to every frame built from
  a brief with a required slot unset; `GAP_ASSET_URI` is the same description as a crossed-box
  SVG data URI, which both exporters hand back from the one function each already had for _the
  bytes of an asset_ — so an `<img src>`, a CSS `background-image` and an SVG `<image href>`
  get it with no call site branching.

  **It carries no glyph, and that is a constraint rather than a preference.** A `Text` needs a
  face declared in the scene and resolved at export, and `E_EXPORT_FONT_UNRESOLVED` is still
  fatal — a marker that can fail on a missing font disappears in exactly the runs it exists
  for. Which slot is missing is what the diagnostic names.

  **The stamp marks the frame and not the slot, which is weaker than the card asked for and is
  the decision.** Where a slot would have been drawn is knowledge only the template has, so a
  mark in the right place would have to be drawn by the template — and a guarantee a
  third-party template can forget is not a guarantee. The exporters, which know a node's box
  exactly, do put their mark in place.

  **Flipping the field would not have been enough on its own.** Both exporters weighed
  diagnostics with `fromDiagnostics`, which reads _severity_, so `fatal: false` on an export
  code changed nothing until they called `fromPartial` — the conversion ADR 0025 made for the
  earlier stages and skipped here, reasonably, since every export error was fatal then.

  **`E_EXPORT_UNSUPPORTED` needed its four producers audited, not just its field changed.** Two
  in `export-html` already left the node visible. Two did not: in `export-svg` a mask naming a
  node outside the frame left `mask="url(#…)"` pointing at nothing, and now gets a pass-through
  `<mask>`; `--text-as-paths` with no outline resolver dropped the words, and now draws them as
  `<text>` through the faces the document already embeds.

  **Measured.** `resolve` also carries the missing names as value (`missingRequiredSlots`),
  because a stage reads its predecessor's value and not its problems. Each new assertion has a
  control beside it — a whole brief carries no stamp, a resolved export carries no mark — since
  a marker that shows up on healthy artwork would be worse than one that never drew.

### Patch Changes

- Updated dependencies [80a03a8]
  - @tyto/core@0.23.0
  - @tyto/plugin-api@0.3.6

## 0.5.5

### Patch Changes

- Updated dependencies [353c83d]
  - @tyto/core@0.22.2
  - @tyto/plugin-api@0.3.5

## 0.5.4

### Patch Changes

- Updated dependencies [91b6bc5]
  - @tyto/core@0.22.1
  - @tyto/plugin-api@0.3.4

## 0.5.3

### Patch Changes

- Updated dependencies [5309eb2]
  - @tyto/core@0.22.0
  - @tyto/plugin-api@0.3.3

## 0.5.2

### Patch Changes

- Updated dependencies [ca8f122]
- Updated dependencies [2cea94a]
  - @tyto/core@0.21.1
  - @tyto/plugin-api@0.3.2

## 0.5.1

### Patch Changes

- Updated dependencies [eb57af0]
  - @tyto/core@0.21.0
  - @tyto/plugin-api@0.3.1

## 0.5.0

### Minor Changes

- 9b3ecd4: TYTO-35 validate `tyto-plugin.json` and list what is installed

  `@tyto/plugin-api` gains `pluginManifestSchema`, `parsePluginManifest` and
  `validatePluginManifest`: the manifest of `docs/plugin-api.md` as a schema, rejecting with
  a field path (`contributes.1`, `config.$schema`) and reporting every problem at once.

  `InProcessHost.activate(plugin, origin?)` is the door a plugin now comes through. It
  validates the manifest, refuses a `name` that disagrees with the plugin's id, refuses a
  contribution to a point the manifest did not declare, and records the plugin so
  `registry.plugins()` can list it.

  `Plugin` therefore carries a `manifest`, typed `unknown` because a manifest is a document
  to be validated rather than a shape to be trusted. Both exporters ship a real
  `tyto-plugin.json` at their package root and export it as `htmlExporterManifest` /
  `svgExporterManifest`. The unused `id` option is gone from both plugin factories: the
  manifest's `name` is the id, and a second name for one plugin is a second thing to keep in
  step.

  `@tyto/core` adds `E_PLUGIN_MANIFEST_SYNTAX` and `E_PLUGIN_MANIFEST_SHAPE`.

### Patch Changes

- Updated dependencies [9b3ecd4]
  - @tyto/plugin-api@0.3.0
  - @tyto/core@0.20.0

## 0.4.2

### Patch Changes

- Updated dependencies [9b44b9d]
  - @tyto/core@0.19.0
  - @tyto/plugin-api@0.2.7

## 0.4.1

### Patch Changes

- Updated dependencies [4519c36]
  - @tyto/core@0.18.0
  - @tyto/plugin-api@0.2.6

## 0.4.0

### Minor Changes

- f0d3d25: Resources are resolved after `compile`, not before (E6.4).

  `sceneResources(scene)` in `@tyto/core` says what a scene asks the outside world for: every
  `AssetRef` it draws and every `SceneFontFace` its runs ask for, deduplicated, found through
  the one `walk()` rather than through a second recursion. `JobPorts.loadResources` is handed
  that list between `compile` and the first `exportFrame` — the only window where the question
  has an answer and the answer is still useful — and may await. Jobs that use it emit a
  `resources` stage event.

  **The eager path is gone, not kept as a fallback.** `fileResources` no longer reads the
  asset folder and is no longer async: it hands out resolvers over an empty store and a `load`
  that fills it with exactly what the scene named. Keeping both alive would have meant two
  ways for an asset to reach a document and no way to tell which one did. A caller that used
  to `await fileResources(...)` now calls it plainly and passes `resources.load` to `runJob`
  as `loadResources`. The template's own `src=` files are unaffected — `templateWiring` reads
  that folder when it loads the template, which is already after the brief named it.

  **`SvgFontFace` now carries `font: FontRef` instead of `family: string`.** It and
  `HtmlFontFace` are both `SceneFontFace` from `core`, which is what lets one list serve both
  exporters; the two used to describe a face differently, so the same scene produced two lists
  that could not be compared. `FontRef` won because it says strictly more — a family alone
  cannot tell a bundled face from one in the brief's folder, and a loader that has to open a
  file needs the `path`. `face.family` becomes `face.font.family`. Both exporters also key
  their face registries with `core`'s `fontFaceKey`, so a document deduplicates exactly as the
  enumeration counts, and the SVG `@font-face` block is now sorted by that key rather than by
  insertion order.

### Patch Changes

- Updated dependencies [f0d3d25]
  - @tyto/core@0.17.0
  - @tyto/plugin-api@0.2.5

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
