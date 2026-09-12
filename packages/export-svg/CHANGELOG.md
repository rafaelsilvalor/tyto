# @tyto/export-svg

## 1.0.1

### Patch Changes

- Updated dependencies [4519c36]
  - @tyto/core@0.18.0
  - @tyto/plugin-api@0.2.6

## 1.0.0

### Major Changes

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

## 0.2.4

### Patch Changes

- Updated dependencies [a40f4d9]
  - @tyto/core@0.16.0
  - @tyto/plugin-api@0.2.4

## 0.2.3

### Patch Changes

- Updated dependencies [04c076c]
  - @tyto/core@0.15.0
  - @tyto/plugin-api@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [15dfa8b]
  - @tyto/core@0.14.1
  - @tyto/plugin-api@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [2f72340]
  - @tyto/core@0.14.0
  - @tyto/plugin-api@0.2.1

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

- ec00f11: Export a `Scene` to one SVG document per frame (TYTO-28)

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
