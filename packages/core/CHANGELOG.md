# @tyto/core

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
