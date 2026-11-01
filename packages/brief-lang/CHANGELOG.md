# @tyto/brief-lang

## 0.7.7

### Patch Changes

- Updated dependencies [9021b50]
- Updated dependencies [93fb9c9]
- Updated dependencies [147eafa]
- Updated dependencies [05c9f83]
  - @tyto/core@0.36.0

## 0.7.6

### Patch Changes

- fc3bee5: Tests and comments stop naming the production templates as if they were built in (TYTO-436): a test's template name is invented or one of the pack's test templates, and a comment about a template in its own repository names the repository. No behaviour changes.
- Updated dependencies [fc3bee5]
- Updated dependencies [6881557]
- Updated dependencies [4168183]
  - @tyto/core@0.35.0

## 0.7.5

### Patch Changes

- Updated dependencies [503f924]
- Updated dependencies [6d431f6]
- Updated dependencies [eca9871]
- Updated dependencies [b7c5136]
- Updated dependencies [b40dea8]
- Updated dependencies [0164874]
- Updated dependencies [cd14464]
  - @tyto/core@0.34.0

## 0.7.4

### Patch Changes

- Updated dependencies [f612e26]
- Updated dependencies [096f80e]
  - @tyto/core@0.33.0

## 0.7.3

### Patch Changes

- Updated dependencies [c590e01]
- Updated dependencies [e7588e9]
- Updated dependencies [4388575]
- Updated dependencies [e2b72a7]
  - @tyto/core@0.32.0

## 0.7.2

### Patch Changes

- Updated dependencies [a5912e7]
  - @tyto/core@0.31.0

## 0.7.1

### Patch Changes

- Updated dependencies [7115286]
- Updated dependencies [46a0b89]
  - @tyto/core@0.30.0

## 0.7.0

### Minor Changes

- 3b261d1: TYTO-294: a blank line has no meaning and does not end an indented block (ADR 0087). One or several blank lines in a row, empty or holding only spaces, inside a block — between two groups of a `::lamina`, or between the directive and its first body line — parse to the AST the brief has without them, and a block ends only at the next non-blank line back at column 0. A line of spaces at the top level is blank too, and a directive's range ends at its last line with text.
- 74d7b28: TYTO-297 (ADR 0096): spaces and tabs at the end of a line of text no longer mean anything. `parseBrief` trims them from the inline body and every line of a block, so **a brief that had trailing spaces renders slightly differently: a centred line such as `Profª. Mara Rebeiro  ` goes back to the centre.** New `formatBrief` and `formatBriefEdits`: the brief rewritten into its canonical shape — body lines indented by `indentUnit` spaces, no trailing spaces, one blank line where there were several, none between a head and its first body line, a final line ending in the file's own style — changing nothing inside a line and nothing the brief compiles to. A brief with a syntax error is refused with its `E_SYNTAX` diagnostics.
- ab9512e: TYTO-330 (ADR 0109): a `\` ending a line of a directive body, with another line of its indented block after it, no longer adds an empty line. Every block line already starts a new line, so `parseBrief` drops that `\` — and the spaces in front of it — and reports the new warning `W_REDUNDANT_BREAK` on it. **A brief that had one renders one empty line shorter, and shows a warning where it used to compile silently.** `\\` there still leaves one empty line, with one warning. A `\` in the middle of a line, at the end of an inline body with no block, or on the last line of a block is unchanged.

### Patch Changes

- Updated dependencies [d4a6939]
- Updated dependencies [08b936d]
- Updated dependencies [7342c02]
- Updated dependencies [15997e9]
- Updated dependencies [93fcb8b]
- Updated dependencies [ea97dc3]
- Updated dependencies [c005b91]
- Updated dependencies [2495d0d]
- Updated dependencies [6abf89f]
- Updated dependencies [53e01c3]
- Updated dependencies [ae75027]
- Updated dependencies [fe85505]
- Updated dependencies [5a0c7c5]
- Updated dependencies [8e9c9c4]
- Updated dependencies [ab9512e]
- Updated dependencies [d3df40e]
- Updated dependencies [4aba89c]
- Updated dependencies [58f54d6]
- Updated dependencies [7a5f578]
- Updated dependencies [3355317]
- Updated dependencies [eb55249]
- Updated dependencies [a2b7fbd]
- Updated dependencies [532221f]
- Updated dependencies [5f98674]
- Updated dependencies [cfa70ff]
- Updated dependencies [bdab5da]
- Updated dependencies [eb0694a]
- Updated dependencies [dded20c]
- Updated dependencies [e4ce1e8]
- Updated dependencies [fdcfda9]
- Updated dependencies [4186112]
- Updated dependencies [3921252]
  - @tyto/core@0.29.0

## 0.6.8

### Patch Changes

- Updated dependencies [b20fe47]
- Updated dependencies [7dad141]
- Updated dependencies [4532332]
  - @tyto/core@0.28.0

## 0.6.7

### Patch Changes

- Updated dependencies [0937670]
- Updated dependencies [37fd201]
- Updated dependencies [7950dc3]
- Updated dependencies [8300c78]
- Updated dependencies [bf7c79a]
- Updated dependencies [8ca8eed]
- Updated dependencies [a84b756]
- Updated dependencies [a33a192]
- Updated dependencies [733f779]
- Updated dependencies [d4aac5b]
- Updated dependencies [94fdee3]
- Updated dependencies [eaf6ece]
- Updated dependencies [cd25d2d]
- Updated dependencies [5c0611f]
- Updated dependencies [82927c8]
- Updated dependencies [a69f493]
- Updated dependencies [64c75bb]
- Updated dependencies [091e2a2]
- Updated dependencies [e35546e]
- Updated dependencies [7659e7e]
- Updated dependencies [525639b]
  - @tyto/core@0.27.0

## 0.6.6

### Patch Changes

- Updated dependencies [17ad960]
  - @tyto/core@0.26.0

## 0.6.5

### Patch Changes

- Updated dependencies [b587f0d]
  - @tyto/core@0.25.0

## 0.6.4

### Patch Changes

- Updated dependencies [8b24969]
  - @tyto/core@0.24.0

## 0.6.3

### Patch Changes

- Updated dependencies [80a03a8]
  - @tyto/core@0.23.0

## 0.6.2

### Patch Changes

- Updated dependencies [353c83d]
  - @tyto/core@0.22.2

## 0.6.1

### Patch Changes

- 91b6bc5: Dependency bumps in the prod group: `yaml` 2.9.0 → 2.9.1, `zod` 4.6.1 → 4.6.5, and
  `@codemirror/commands`, `@codemirror/state` and `@codemirror/view` to their latest patches.

  These are dependencies of what ships, so they get a patch and a line in the changelog rather
  than passing through unnamed. Written by hand because Dependabot cannot write a changeset — it
  has no idea this repository uses them — which is what makes every one of its PRs arrive red on
  `changeset status`. TYTO-155 is the card for fixing that properly.

- Updated dependencies [91b6bc5]
  - @tyto/core@0.22.1

## 0.6.0

### Minor Changes

- 5309eb2: TYTO-107 — a stage may produce a value and still report errors

  A brief with one error anywhere used to render nothing. It now renders the slots that are
  fine and reports the one that is not, because severity and fatality are two questions and
  they were one field (ADR 0025).

  **`Ok<T>.warnings` is `Ok<T>.diagnostics`.** It no longer holds only warnings: a non-fatal
  error rides the ok branch beside the part of the value that survived. A code declares
  `fatal` beside `severity` in the catalogue, `fromPartial(value, items)` is what a stage with
  something partial to hand back returns, and `hasFatal` is the test. `fromDiagnostics` is
  unchanged and is still right for a stage with nothing partial to offer. `withWarnings` is
  `withDiagnostics`.

  **Severity still decides the exit code.** A partly rendered brief is `hasErrors` and fails a
  build; what changed is that it also writes its artifacts, so `result.json` is
  `status: error` with a non-empty `artifacts` — the state `docs/render-contract.md` now calls
  _rendered, with errors_.

  **`E_SYNTAX` split three ways**, because fatality is a property of the code: `E_SYNTAX` is a
  line of the brief body and is not fatal, `E_FRONTMATTER_SYNTAX` is the block that names the
  template and is, and `E_TEMPLATE_SYNTAX` is a `template.html` and is. `docs/diagnostic-codes.md`
  publishes the whole list with the reason for each entry.

  **A failed frame no longer costs the report.** `runJob` returns its `JobReport` with the
  errors riding along, so the eleven frames of twelve that rendered are listed rather than
  dropped — `result.json` used to say `artifacts: []` over a folder the same run had written
  nine files into.

  `E_MISSING_REQUIRED_SLOT` and the unresolved-export codes stay fatal on purpose: each would
  leave a hole in the artwork that nothing in the artwork names, and art that looks finished
  with a slot silently empty is the failure this card had to avoid.

### Patch Changes

- Updated dependencies [5309eb2]
  - @tyto/core@0.22.0

## 0.5.9

### Patch Changes

- aa6c851: CodeMirror 6 with the brief language (TYTO-36).

  `@tyto/editor` has an API: `createEditor(parent, options)` mounts an editor and hands back
  `getValue`, `setValue`, `onChange`, `setTheme`, `destroy` and the `EditorView` underneath.
  The renderer, the demo page and a web build all mount one the same way, and none of them
  imports CodeMirror — a React wrapper in `apps/desktop` is a `useEffect` around four methods.

  The language is the grammar `@tyto/brief-lang` already ships, configured rather than
  described a second time, so the editor and the compiler cannot disagree about what a brief
  means. Folding is the one thing this package adds to the tree: a directive with an indented
  body folds to its first line, and one with an inline body does not fold at all because there
  would be nothing left to show.

  `onChange` reports what the author typed and stays quiet when the host writes. `setValue`
  carries an annotation the update listener reads, which is what keeps E9.2 from saving the
  file it has just opened.

  Two themes, swapped through a compartment so switching does not rebuild the state. What they
  carry is the chrome and the syntax colours together — a host that could swap one without the
  other would get dark text on a dark background.

  **Five of the eleven entries in `@tyto/brief-lang`'s highlight table were wrong, and
  rendering it is what showed.** Three of them named `directiveMark`, `braceOpen`,
  `braceClose`, `markClose`, `boldMark`, `italicMark`, `adjustmentSep` and `valueSep`, and
  matched nothing: only a capitalised Lezer rule produces a node, so all eight were spelled
  after characters that have no name in the tree. And
  `Bold: tags.strong` reaches the two asterisks and not the word between them, because a tag
  stops at the first child unless it is written `Bold/...`. Neither mistake throws or warns.
  The table is respelled — punctuation through the construct that contains it, emphasis with
  `/...` — and `highlight.test.ts` now reads the spans a renderer receives instead of the
  table. Restoring the old spelling fails 5 of its 11 cases and 2 of the editor's 20.

  `packages/editor/demo/` is the acceptance criterion: `pnpm --filter @tyto/editor demo` opens
  the two example briefs the built-in templates ship, with a theme switch and a read-only
  toggle. It imports `createEditor` and nothing else, so anything it cannot do, `apps/desktop`
  will not be able to do either. `vite build` bundles it in 234 modules with no Node shim,
  which is the other half of the criterion.

  Not here: vim mode and the command registry (E8.3), lint markers and manifest-driven
  completion (E8.2), the template language (E8.4). The keymap is CodeMirror's defaults plus
  history and folding, and E8.3 replaces that layer.

## 0.5.8

### Patch Changes

- Updated dependencies [ca8f122]
- Updated dependencies [2cea94a]
  - @tyto/core@0.21.1

## 0.5.7

### Patch Changes

- Updated dependencies [eb57af0]
  - @tyto/core@0.21.0

## 0.5.6

### Patch Changes

- Updated dependencies [9b3ecd4]
  - @tyto/core@0.20.0

## 0.5.5

### Patch Changes

- Updated dependencies [9b44b9d]
  - @tyto/core@0.19.0

## 0.5.4

### Patch Changes

- Updated dependencies [4519c36]
  - @tyto/core@0.18.0

## 0.5.3

### Patch Changes

- 64153ab: A brief parses whatever line ending wrote it (E3.6).

  `parseBrief` accepted the newline and nothing else. A file saved on Windows failed at the
  frontmatter fence and then cascaded — every directive after it reported incomplete, with no
  diagnostic mentioning line endings, so an author read "unexpected `---`" about a `---` that
  was plainly correct.

  The endings are read by the grammar rather than normalised away first. Normalising moves
  every offset by one unit per line, and a `Diagnostic.range` indexes the text the caller
  handed in: an editor highlighting a range computed against a shorter string would underline
  the wrong characters in a Windows buffer. So the tokens learned the other two endings,
  offsets stay the caller's, and `createLineIndex` in `@tyto/core` already counted all three
  as one line end — line and column came out right as soon as the offsets did.

  Three other places had the same assumption and were fixed with it: the frontmatter
  tokenizer scanned for the newline by hand, `bodySpan` searched for one to find the fences
  (a classic-Mac file contains none, so the body started at offset 0 and the fence itself
  parsed as YAML), and the `Break` node between two lines of an indented block had a
  hardcoded one-unit span that covered half of a two-unit ending.

  Inside the frontmatter there is one substitution: `yaml` ends a line on the newline and on
  the pair, but not on a lone carriage return, so those are swapped before it parses. One code
  unit for one, so no offset moves — the trap above stays shut.

  `@tyto/template-lang` was measured and needed no change: its whitespace token already took
  the carriage return, and `@skip` drops it everywhere. A test records that rather than
  leaving it assumed.

## 0.5.2

### Patch Changes

- Updated dependencies [f0d3d25]
  - @tyto/core@0.17.0

## 0.5.1

### Patch Changes

- Updated dependencies [a40f4d9]
  - @tyto/core@0.16.0

## 0.5.0

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

### Patch Changes

- Updated dependencies [04c076c]
  - @tyto/core@0.15.0

## 0.4.9

### Patch Changes

- Updated dependencies [15dfa8b]
  - @tyto/core@0.14.1

## 0.4.8

### Patch Changes

- Updated dependencies [2f72340]
  - @tyto/core@0.14.0

## 0.4.7

### Patch Changes

- Updated dependencies [e994ca9]
  - @tyto/core@0.13.0

## 0.4.6

### Patch Changes

- Updated dependencies [3a782b3]
  - @tyto/core@0.12.0

## 0.4.5

### Patch Changes

- Updated dependencies [192d674]
  - @tyto/core@0.11.0

## 0.4.4

### Patch Changes

- Updated dependencies [7d0ebce]
  - @tyto/core@0.10.0

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
