# @tyto/brief-lang

## 0.4.3

### Patch Changes

- Updated dependencies [1c5982c]
  - @tyto/core@0.9.0

## 0.4.2

### Patch Changes

- Updated dependencies [56fa7c1]
  - @tyto/core@0.8.0

## 0.4.1

### Patch Changes

- Updated dependencies [a51c3e8]
  - @tyto/core@0.7.0

## 0.4.0

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

### Patch Changes

- Updated dependencies [6acd5a9]
  - @tyto/core@0.6.0

## 0.3.1

### Patch Changes

- Updated dependencies [5880068]
  - @tyto/core@0.5.0

## 0.3.0

### Minor Changes

- 8636b0c: Add `parseBrief`, which turns the Lezer tree into a typed `BriefAst`.

  `brief-lang` now exports `parseBrief(text): Result<BriefAst, Diagnostic[]>` and the AST
  types (`BriefAst`, `Directive`, `Adjustment`, `Inline` and its members). Frontmatter is
  parsed with `yaml`; syntax errors and invalid frontmatter come back as `E_SYNTAX`
  diagnostics with a range, one per position.

  `core` gains the `E_SYNTAX` code, which the parse stage needed and the catalog did not
  have.

### Patch Changes

- Updated dependencies [8636b0c]
  - @tyto/core@0.4.0

## 0.2.0

### Minor Changes

- 3266f98: Emphasis now nests in both directions: `*italic with **bold** inside*` parses, alongside `**bold with *italic* inside**`, which already did. Neither kind may hold itself, which is the ambiguity `*a*b*c*` poses and the one an LR parser cannot resolve.

  Two adjacent closers still do not parse — `**bold *italic***` leaves both runs open, because longest match reads the trailing `***` as `**` then `*`. Write `**bold *italic* **` or reorder. `broken-adjacent-emphasis.brief` pins where the error lands: four identical empty nodes at the end of the line, which the editor has to collapse by offset.

  ADR 0015 records the decision and hands E3.2 the consequence: `Bold` and `Italic` carry `children`, not a string.

## 0.1.0

### Minor Changes

- 01d9b27: Add the Lezer grammar for the brief language: frontmatter, `::name` and `::ns/name` directives with an inline or indented body, `{a, b: value}` adjustments, inline markup (`**bold**`, `*italic*`, `\` break, `{k:v}…{/}` marks), `//` comments and the `\::` escape. `parser` and `briefHighlighting` are exported, so the compiler and the editor read the same tree and cannot disagree about what a brief means.

  The grammar is built from `brief.grammar` by `generate:parser`, which `build`, `typecheck` and `test` all depend on; the generated parser is build output and is not committed.

  A corpus of 23 fixtures pins the behaviour — 17 that must parse with no error node, 6 that must not, each asserting where the error actually lands. Recovery keeps parsing past the damage, so a half-typed brief still highlights.
