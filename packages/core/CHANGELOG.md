# @tyto/core

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
