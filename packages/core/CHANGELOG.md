# @tyto/core

## 0.15.0

### Minor Changes

- 04c076c: A directive is ranged twice: the whole of it, and its name (E3.4).

  `Directive` gains `nameRange`, a span over the name alone. It takes in the namespace and
  its slash — `::ai/caption` underlines `ai/caption` — and leaves out the `::`, which is the
  only way to write a directive and therefore never the part that is wrong.

  `resolve` reports `E_UNKNOWN_SLOT` and `E_UNKNOWN_DIRECTIVE` against it. A misspelled name
  on a directive with a three-line body used to underline all four lines, because `range` was
  the only span there was. Every other diagnostic keeps the range it had: they are about the
  value, and the value is the body.

  A frontmatter key is already its own name, so that half of `E_UNKNOWN_SLOT` needed nothing.

## 0.14.1

### Patch Changes

- 15dfa8b: Close three loose ends left open by E3.3 and E4.1 (E4.7).

  `min` and `max` are now refused where they would count nothing. They mean occurrences on a
  repeatable slot and characters on every other one, and only `rich-text` has characters — so
  `{ type: image, max: 60 }` is `E_MANIFEST_SHAPE` at `slots.<name>.max` instead of a cap that
  silently never fires. Adding `repeat: true` makes the same pair meaningful again for any
  type.

  A repeat count below `min` now carries a range. There is no occurrence to point at when the
  brief wrote none, so it falls back to the span `E_MISSING_REQUIRED_SLOT` already uses rather
  than arriving somewhere an editor cannot draw it. Too _many_ is unchanged: the first
  occurrence over the limit is right there and still takes the blame.

  `IDENTIFIER` in `template/manifest.ts` is the grammar's `identifier` token written a second
  time — `brief-lang` depends on `core`, so it cannot be imported from where it belongs. A new
  check in `tools/repo-checks` translates the token into a regex and compares the two, so
  moving one without the other fails `pnpm check` instead of drifting in silence.

## 0.14.0

### Minor Changes

- 2f72340: Text is measured and wrapped in the IR (E4.5).

  `compile` now takes `faces`, a `FaceCache` built from the new `FontSource` port, and uses it
  to decide where every line of a `TextNode` ends. The breaks come back as `LineBreak` runs,
  so both exporters draw the same lines instead of each guessing — which closes ADR 0019's
  "an SVG does not wrap". `overflow: 'shrink'` is resolved the same way: the runs come out at
  the size that fits and the node becomes `'clip'`, because the shrink has happened.
  `W_TEXT_OVERFLOW` reports what still does not fit, naming the brief's directive and
  carrying its range.

  Measuring is fontkit over the bundled outlines, and it agrees with Chromium: on the
  `text.feed` corpus the line counts match exactly and the block heights are within 0.0125px,
  against a ±1px criterion.

  `JobPorts.faces` passes the cache through `@tyto/pipeline`. Both options are optional and a
  caller that omits them gets exactly the previous behaviour — no adapter supplies fonts to a
  production job yet, so nothing changes for the CLI until one does.

## 0.13.0

### Minor Changes

- e994ca9: TYTO-33 — what the `tyto` command needed from the packages under it.

  `core`: `ResolveOptions.formats`, the `--formats` flag's way in. It is a **fallback and not
  an override**, mirroring `ResolveOptions.template`: the frontmatter's `formats` still wins,
  so there is one rule for a reader rather than two. A format it names that the manifest does
  not render is the same `E_UNKNOWN_FORMAT` the frontmatter would get, with no range attached
  because a flag is not a position in a file. New diagnostic code `E_INPUT_READ`, for a file a
  command was pointed at and could not open — `E_TEMPLATE_READ` was the nearest thing and its
  summary is about templates.

  `pipeline`: `JobRequest.formats`, passed straight to `resolve`. The job does not filter
  frames afterwards — a frame nobody asked for should never be built, not built and dropped.

  `io`: `fsTaskOutput(directory)`, the `TaskOutput` over one folder that `fsOutbox` is now
  written in terms of. `tyto render --out <dir>` writes into exactly the folder it was given
  (`docs/integrations.md`), while the outbox derives `<root>/<id>/out` from a task id; the
  atomic write underneath is the part neither may have its own copy of. Also
  `fileTemplateAssets(...)`, which reads the files beside a `template.html` that its `src=`
  attributes name — `markupTemplateSource` has always left that to whoever composes it, and
  before this nothing did, so a template with a `<vector src>` could not render.

## 0.12.0

### Minor Changes

- 3a782b3: `runJob`: a brief in, artifacts out. It composes `parseBrief` → `resolve` → `compile` → `export` → `raster` with every capability injected as a port, names each artifact `<artwork>-<format>.<ext>` (ADR 0011), limits how many frames raster at once, and reports progress through a tagged `JobEvent` union. A three-slide brief in two formats asked for as PNG and SVG produces twelve files.

  Two ports are declared here because nothing else could: `TemplateSource`, since `TemplateRegistry` reads manifests and `compile` needs a build function, and `ArtifactSink`, implemented by `io` in E6.2 — a job with no sink returns its artifacts in memory and opens no files. Every frame is attempted individually with `exportFrameHtml`/`exportFrameSvg`, so one broken frame of twelve is reported alongside the other eleven instead of replacing them; an `AbortSignal` stops the job handing anything further to the sink.

  `@tyto/core` gains two diagnostic codes for what a job can report and no stage could: `E_RENDER_FAILED` for a frame that produced no bytes, and `E_OUTPUT_WRITE` for one that could not be written.

## 0.11.0

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

## 0.10.0

### Minor Changes

- 7d0ebce: Parse `template.html` into a template function (TYTO-24)

  `@tyto/template-lang` now has its own Lezer grammar for the HTML-like markup and
  `compileTemplate(source, { manifest, assets })`, which returns the same `Template` a
  `template.ts` exports — so `compile` cannot tell the two authoring paths apart. The markup
  path additionally reports `renderedSlots`, which is what `resolve` needs to emit
  `W_UNUSED_SLOT`.

  Three contradictions inside `docs/template-authoring.md` are settled in the same pass:
  `content: slot(…)` is gone (`slot="x"` is the only way to draw a slot), `bg` and `format`
  join the frame's accepted attributes, and `@each <slot>` is documented as a scope rather
  than a loop.

  `@tyto/core` gains `E_UNSUPPORTED_TAG`, `E_UNSUPPORTED_ATTRIBUTE` and `E_TEMPLATE_MARKUP`,
  and exports `didYouMean`/`editDistance` — `resolve` and the template parser both need the
  same suggestion budget.

## 0.9.0

### Minor Changes

- 1c5982c: Add the project's format catalogue, `formats.yaml`.

  `parseFormats(source, path)` and `loadFormats(fileSystem, path)` read a mapping of format
  id to `{ w, h, label? }` — the one place a number like 1080×1920 is written. `compile` now
  takes a `FormatCatalogue` and hands each template call `context.size`, so a template states
  its layout and not its canvas, and two templates cannot disagree about what `story` is. A
  template rendering a format the project does not define is `E_FORMAT_NOT_DEFINED`, raised
  once before any frame is built.

  The YAML-to-diagnostic machinery `parseManifest` used is now shared
  (`src/config/yaml-source.ts`), so both files report the path of the offending key and a
  range over its value the same way.

  New diagnostic codes: `E_FORMATS_SYNTAX`, `E_FORMATS_SHAPE`, `E_FORMAT_NOT_DEFINED`.
  `compile` takes a third argument.

## 0.8.0

### Minor Changes

- 56fa7c1: Add `defineTemplate`, `runsOf` and the `compile` stage.

  `compile(resolved, template)` expands the repeatable slot into one `Artwork` per
  occurrence, calls the template once per (artwork, format), collects the fonts and assets
  the resulting scene reached for, and validates the whole thing with `parseScene`. Nothing
  a template throws escapes: a `TemplateError` surfaces the diagnostic it built and anything
  else becomes `E_TEMPLATE_CRASH` (ADR 0014).

  `defineTemplate(manifest, build)` pairs a manifest with that function. Its context carries
  the format, the artwork's id, index and count, every slot with the repeatable one already
  resolved to this artwork, that artwork's adjustments, and an `idPrefix` a template must
  pass to `frame()` — it carries both the artwork and the format, because either alone
  collides.

  `runsOf(text, style, options)` turns the rich text of a brief into `TextRun[]`: bold
  becomes a weight, italic a style, a `Break` a `LineBreak` run (ADR 0016), and a mark
  whatever the template maps it to.

## 0.7.0

### Minor Changes

- a51c3e8: Make a line break a run in the Scene IR (ADR 0016).

  `TextRun` is now a discriminated union: `TextSpan { kind: 'text', … }` or
  `LineBreak { kind: 'break' }`. A break is a member of the run list rather than a `\n`
  inside a span's text, so no exporter has to scan a string to find one — the same rule that
  keeps colour structured. `compile` (E4.2) now has somewhere to put the `Break` inline that
  `parseBrief` produces for a trailing `\` and for a block line boundary.

  Leading, trailing and consecutive breaks are legal; a `LineBreak` carries no styling.
  `E_SCENE_EMPTY_TEXT` widens from "no runs" to "nothing to draw", so a text node whose runs
  are all breaks is now caught by the invariant that already caught an empty one.

  The template SDK gains `lineBreak()` beside `run()`, and `run()` returns a tagged
  `TextSpan`.

## 0.6.0

### Minor Changes

- 6acd5a9: Add `resolve`: `BriefAst` × manifest → `ResolvedBrief`.

  `resolve(ast, { registry, assets, template?, renderedSlots? })` validates a brief against
  the template it names — slot existence and types, required slots, repeat counts, enum
  values, adjustments allowed per slot, asset existence through the new `AssetResolver`
  port, and formats — and produces typed slot values plus one artwork per occurrence of the
  repeatable slot. Every diagnostic carries the range of the directive or frontmatter key
  that caused it, and `E_UNKNOWN_SLOT` suggests the declared name a typo is closest to.

  **The brief AST types moved from `@tyto/brief-lang` to `@tyto/core`**, where `Scene`
  already lives: `resolve` consumes a `BriefAst` and `core` cannot import `brief-lang` back.
  `brief-lang` re-exports them, so imports from it keep working. `BriefAst.frontmatter` is
  now a `Frontmatter` — `data`, per-key `ranges` and the block `range` — rather than a bare
  record, which is what lets a diagnostic point at one key.

  New diagnostic codes: `E_NO_TEMPLATE`, `E_UNKNOWN_TEMPLATE`, `E_UNKNOWN_FORMAT`,
  `E_BAD_SLOT_VALUE`.

## 0.5.0

### Minor Changes

- 5880068: Add the template manifest schema and `TemplateRegistry`.

  `templateManifestSchema` and `parseManifest(source, path)` validate a `manifest.yaml`,
  reporting every problem in one pass with the YAML path of the offending key and the range
  of the value under it. Beyond the shape it enforces the rules a shape cannot state: one
  repeatable slot per manifest, enum values and defaults, `applies` naming a declared slot,
  and slot names the brief language can actually write.

  `loadTemplateRegistry(fileSystem, root)` discovers templates by folder through the new
  `FileSystem` port, reading manifests and never `template.ts` or `template.html`. It
  exposes `list()`, `get()`, `formatsOf()` and `directoryOf()`, and keeps per-folder
  failures beside the templates that loaded.

  New diagnostic codes: `E_MANIFEST_SYNTAX`, `E_MANIFEST_SHAPE`, `E_TEMPLATE_DUPLICATE`,
  `E_TEMPLATE_READ`.

## 0.4.0

### Minor Changes

- 8636b0c: Add `parseBrief`, which turns the Lezer tree into a typed `BriefAst`.

  `brief-lang` now exports `parseBrief(text): Result<BriefAst, Diagnostic[]>` and the AST
  types (`BriefAst`, `Directive`, `Adjustment`, `Inline` and its members). Frontmatter is
  parsed with `yaml`; syntax errors and invalid frontmatter come back as `E_SYNTAX`
  diagnostics with a range, one per position.

  `core` gains the `E_SYNTAX` code, which the parse stage needed and the catalog did not
  have.

## 0.3.1

### Patch Changes

- 66713e2: Add `E_TEMPLATE_CRASH` to the diagnostic catalog: a template that throws something other than a `TemplateError` is a bug in third-party code, and the compile stage turns it into a diagnostic instead of letting it crash the app or the CLI.

  ADR 0014 records the decision the code was already assuming — `color()` throws rather than returning a `Result`, and `compile` is the single `catch` where that stops.

## 0.3.0

### Minor Changes

- 44aaffc: Add `SceneVisitor<T>` and `walk()`, the one traversal of the Scene IR. Every node is handed a `VisitContext` carrying the accumulated transform as a `Matrix`, the effective opacity, the ancestor chain, and the frame and format it belongs to, so no exporter composes any of that a second time. A visitor never recurses: `walk()` descends and gives `group()` the results its children already produced. Hidden nodes are visited rather than skipped — a mask is often `visible: false` and still has to be rendered — and the decision to ignore one belongs to the visitor.

  Ships the first two callers: `parseScene`'s invariants, and `frameBounds`/`sceneBounds`, which give the axis-aligned box the visible nodes occupy. Bounds are layout bounds, not ink: stroke overhang and effects are excluded. `Bounds.exact` is false when a node did not fully declare its own box — a text sized by its content, or one that may `grow` — so the box is at least that large and never smaller, and a caller that must not clip knows to pad until E4.5 measures laid-out text.

- a0174c5: Add the template SDK at `@tyto/core/template`: `frame`, `group`, `rect`, `text`, `image` and `vector`, plus the values that feed them — `color`, `solid`, `linearGradient`, `radialGradient`, `imagePaint`, `stop`, `font` and `run`. A template writes what differs and the builders fill the rest with the IR defaults, so a bare rect still carries an identity transform, opacity 1, blend normal and an empty effect list.

  The six node builders return drafts; `frame()` turns them into IR by assigning every id a template left out, derived from the node's position (`feed.0`, `copy.0`) so it is stable across runs. A frame only sees its own subtree, so `idPrefix` is how an assembler keeps ids unique across artworks.

  Misuse is a type error where a type can hold it: a text without runs and a gradient with fewer than two stops do not compile. A hex string's contents cannot be checked by a type, so `color('#gggggg')` throws a `TemplateError` carrying a ready `E_TEMPLATE_VALUE` diagnostic — a bad colour literal is a bug in code, not something a brief author can cause.

## 0.2.0

### Minor Changes

- a0eac58: Add the Scene IR: the Zod schema for `Scene`, `Artwork`, `Frame` and the five node kinds, with types inferred from the schema rather than written twice. `parseScene` validates the shape and then the four cross-node invariants from `docs/ir-schema.md` — unique ids, a mask that points at a real non-descendant node, fonts and assets declared on the scene, no text without runs — and reports every problem it finds, each naming the id at fault.

## 0.1.0

### Minor Changes

- aa3772e: Add the error vocabulary the rest of the pipeline is built on: `Result` with its combinators, `Diagnostic` and the `E_*`/`W_*` catalog, and source-range helpers. Warnings travel on the success branch (ADR 0013). `docs/diagnostic-codes.md` is generated from the catalog by `pnpm docs:gen`.
