# @tyto/brief-lang

## 0.12.3

### Patch Changes

- Updated dependencies [48cca9b]
  - @tyto/core@0.52.0

## 0.12.2

### Patch Changes

- Updated dependencies [0057d72]
  - @tyto/core@0.51.2

## 0.12.1

### Patch Changes

- Updated dependencies [99e90f3]
  - @tyto/core@0.51.1

## 0.12.0

### Minor Changes

- 1134d6e: The one-image table shares its width by reading every cell of a column: from the minimums, the
  leftover goes where it makes the table shortest, so one long cell in a row held tall by another
  column no longer takes the room. A `::tabela` line with no `|` that starts with `*` is a note,
  set small under the table; a `\` inside a row is a line break in that cell. A long
  parenthesised phrase may break, its last word never alone, and a dash stays with the word
  before it. A title the author broke into lines keeps exactly those
  lines, set smaller until each fits whole. In briefs, a lone `*` nothing on its line closes is a literal asterisk (ADR 0214),
  and a `Break` the author typed carries `typed: true`.

### Patch Changes

- Updated dependencies [a73ab4e]
- Updated dependencies [1134d6e]
  - @tyto/core@0.51.0

## 0.11.2

### Patch Changes

- Updated dependencies [fb4d987]
  - @tyto/core@0.50.0

## 0.11.1

### Patch Changes

- Updated dependencies [560d12e]
- Updated dependencies [2d49c56]
  - @tyto/core@0.49.0

## 0.11.0

### Minor Changes

- 7ddffdd: A text line at column 0 under a directive is a body line of that directive, exactly as if it
  were indented (TYTO-708, ADR 0202): `::lamina` / `Linha um` / `Linha dois` is one slide with
  two lines and compiles to the Scene of its indented twin. A blank line between two column-0
  lines is a paragraph, and a column-0 comment followed by column-0 text stays in the block
  (ADR 0204, note of 2026-11-16). Text before the first directive is still `E_SYNTAX`. No brief
  that compiled before changes: a column-0 text line used to be a syntax error.

  `@tyto/core`: new warning `W_LIKELY_DIRECTIVE`, for a column-0 body line that starts with a
  single `:` and a name (`:titulo X`), which is kept as text.

  `@tyto/editor`: tests pin folds, `briefBlocks`, sticky scroll and completion on a column-0
  body line (test only). `@tyto/template-kit`: a contract test compiles the unindented brief
  against its indented twin (test only).

- 5bb9f91: A slot nests inside another by its `per`, to any depth (TYTO-709, ADR 0207). `per` may now
  name another `per` slot (`paragrafo: { per: bloco }`, `bloco: { per: lamina }`), and a
  directive belongs to the nearest open occurrence of its parent above it. A template reads a
  slide's own slots flat in `context.slots`, as before, and deeper values in an optional `slots`
  on their parent: `context.slots.bloco.slots?.paragrafo`. No protocol bump.

  **Breaking for one rare case:** an indented `::` line is now a directive, exactly as at
  column 0 (ADR 0202 decision 3). A brief that used an indented `::` as text — 0 of 405 `.brief`
  files measured on the maintainer's machine — now reads it as a directive, usually
  `E_UNKNOWN_SLOT`; write `\::` to keep it text. An indented `//` is still a comment.

  `@tyto/core`: `slotDepth` is exported; the manifest refuses a `per` cycle, a `per` chain that
  does not end at the repeatable slot, and `multiple` below the slide. A new brief's skeleton
  writes a required nested slot under its required parent, one level deeper.

  `@tyto/brief-lang`: `formatBrief` takes an optional `depthOf` and indents each directive by
  its depth in the template's tree.

  `@tyto/editor`: Format Brief reads the depth from the analysis's manifest; `briefBlocks` gives
  each block its `depth` and `parent`; the breadcrumb names the chain
  (`::lamina 2 › ::bloco › ::paragrafo`) and Go to Block indents a nested label.

  `@tyto/plugin-api`: a test pins that nested slots cross to an isolated template (test only).

- 4c9efc2: A brief writes a formula between two `$`: `$F = \frac{1}{40·10^{-3}} = 25\ Hz$` draws a
  stacked fraction, `^` a superscript and `_` a subscript (TYTO-734, ADR 0206). Money stays
  text: a `$` opens a formula only before a character that is not a space and closes one only
  before a character that is not a digit, so `R$ 50` and `R$50 a R$60` hold none. An unknown
  command, a bad group or an empty formula is `E_FORMULA_COMMAND`, `E_FORMULA_GROUP` or
  `E_FORMULA_EMPTY` on the characters at fault, and the formula is drawn as written.

  `@tyto/core`: the AST's `Inline` gains `Formula { kind: 'formula', source, math, children,
range }`. `children` holds the formula's linear reading as plain text, so a traversal that
  reads rich text through `children` keeps working; a `switch` over `inline.kind` that is
  exhaustive stops compiling until it handles `formula`. `runsOf` turns a `Formula` into a
  `FormulaRun` in the style around it. `layoutFormula` now places a text piece word by word
  and draws no space, so an HTML document no longer drops the space after a fraction.
  A fraction now has 0.12 em of room on each side, outside its rule
  (`FRACTION_SIDE`), so it is 0.24 em wider than before.

  `@tyto/raster`: the visual suite renders the reference formula from a brief (test only).
  `@tyto/plugin-api`: a test handles the new inline (test only).

- 73070bb: A `$…$` formula is coloured in the editor, part by part (TYTO-743): its text in the literal
  colour, its `$` and its `^` and `_` in the punctuation's, a command such as `\frac` as a
  keyword, its braces as brackets and `\ `, `\$`, `\{`, `\}` as escapes. No new colour token.

  `@tyto/brief-lang`: new `formulaMounts`, a `wrap` that mounts a small parser on each `Formula`
  node and splits it into `FormulaMark`, `FormulaCommand`, `FormulaBrace`, `FormulaScript` and
  `FormulaEscape`, styled through `briefHighlighting`'s companion table; `formulaText` is the
  tag of a formula's text. `parser` and `parseBrief` are unchanged: only the editor mounts it.

  `@tyto/editor`: the brief language configures the mount; the theme styles `formulaText` and
  `tags.operator`; a block's first text, which Go to Block lists, reads a formula
  as its linear reading, `F = 1/(40·10^(-3)) = 25 Hz`, or as written when it has an error. The
  sticky header draws a formula on a block's head line coloured, as the line itself is.

### Patch Changes

- 5def566: Several values of a nested slot in one parent (TYTO-746, ADR 0207 note of 2026-11-16).
  `multiple: true` may now be declared on any `per` slot, at any depth: with
  `bloco: { per: lamina, multiple: true }`, every `::bloco` in the same slide is a value of its
  own, with its own body and nested slots, in brief order. A template still reads
  `context.slots.bloco` as the first one, and iterates every one through its new optional
  `occurrences` (`slot.occurrences ?? [slot]`). A manifest that declares no `multiple` resolves
  to exactly what it did. An image slot `per` the repeatable slot keeps ADR 0160's pictures among
  a slide's lines.

  `@tyto/core`: on a `multiple` slot `max` counts occurrences per parent, and one past it is
  `E_BAD_SLOT_VALUE` at its own line; `min` on a `multiple` slot, and `multiple` without `per`,
  are manifest errors. `listsOccurrences` is exported.

  `@tyto/brief-lang`, `@tyto/editor`, `@tyto/plugin-api`: tests only — a fixture with two blocks
  per slide and two paragraphs per block, the block list, breadcrumb, Go to Block and fold over
  siblings, and `occurrences` crossing to an isolated template.

- 39207a9: Format Brief keeps a blank line inside a block only where it is a paragraph: a line of text of the block on each side, with comments skipped. A blank line next to a comment with no text on its other side is now dropped.
- Updated dependencies [7ddffdd]
- Updated dependencies [5bb9f91]
- Updated dependencies [4c9efc2]
- Updated dependencies [5def566]
  - @tyto/core@0.48.0

## 0.10.0

### Minor Changes

- d52b7b7: TYTO-557: a blank line between two lines of text makes a paragraph, and the template sets its
  space (ADR 0205, superseding ADR 0087 on this point). `parseBrief` marks the `Break` at the
  boundary `paragraph: true`; several blank lines are one, and one at the start or the end of a
  block, or a comment line, makes none. `runsOf` takes `paragraphSpacing` (px) and the Scene's
  `LineBreak` gains an optional `space`; template-kit's `TextStyle` passes `paragraphSpacing`
  through. Layout counts the space in the height and scales it with a shrink; `export-html` draws
  it as a block that tall after the `<br>`, `export-svg` moves the next baseline down. The
  default is 0, which writes the plain break: a template that declares nothing draws exactly as
  before. Format Brief keeps a blank line under a head with text of its own, and `writeBrief`
  keeps a run of blank lines between two lines of a value as one.

### Patch Changes

- Updated dependencies [d52b7b7]
- Updated dependencies [052247d]
  - @tyto/core@0.47.0

## 0.9.0

### Minor Changes

- 69b00fe: TYTO-680: a comment line inside an indented block is skipped and the block goes on (ADR 0204).
  An indented `//` line is always a comment of its block; a `//` at column 0 is the block's when
  indented lines follow it, and a top-level comment otherwise. A body line that starts with `//`
  is written `\//`, and `writeBrief` escapes one. This changes one brief that compiled before: an
  indented line starting with `//` was body text and is now a comment. Format Brief indents a
  comment inside a block like its body lines; the editor folds it with the block, counts it in
  the block's range and offers no completion in front of it.

### Patch Changes

- Updated dependencies [a232861]
- Updated dependencies [54bbebf]
- Updated dependencies [85f200f]
- Updated dependencies [917636f]
  - @tyto/core@0.46.0

## 0.8.4

### Patch Changes

- Updated dependencies [46a013d]
- Updated dependencies [d700cf3]
- Updated dependencies [ef76145]
- Updated dependencies [1fae4a5]
- Updated dependencies [30bb335]
- Updated dependencies [399281d]
- Updated dependencies [ca2bc10]
  - @tyto/core@0.45.0

## 0.8.3

### Patch Changes

- Updated dependencies [9aa8b41]
- Updated dependencies [68a241a]
- Updated dependencies [fe22e84]
- Updated dependencies [0ed9eba]
  - @tyto/core@0.44.0

## 0.8.2

### Patch Changes

- Updated dependencies [4cae56d]
- Updated dependencies [94c593c]
  - @tyto/core@0.43.1

## 0.8.1

### Patch Changes

- Updated dependencies [7345ac7]
  - @tyto/core@0.43.0

## 0.8.0

### Minor Changes

- 4db076c: A recipe gains the generic sink `to-brief template=<name> into=<folder> name=<column>
slots=<slot>:<column>,…` (TYTO-380, ADR 0172): it plans one brief per row in the chosen template,
  each marked new or overwriting, and writes them on Apply through `ToBriefPorts` the host lends
  through `createVerbRegistry({ briefs })` and `recipeRegistriesOf`'s `briefs` option; a file
  changed since the plan fails that write while the others apply. `@tyto/brief-lang` gains
  `writeBrief`, which writes a brief from a template name and slot values and parses it back,
  refusing a value that holds a brace. `@tyto/core` gains `fileSafeName`, which the pipeline's
  `artifactName` now calls, and the diagnostic code `E_RECIPE_BRIEF`.

### Patch Changes

- Updated dependencies [cd096ab]
- Updated dependencies [ed7a364]
- Updated dependencies [4a91cef]
- Updated dependencies [4db076c]
- Updated dependencies [c0875cc]
- Updated dependencies [64a7b70]
  - @tyto/core@0.42.0

## 0.7.13

### Patch Changes

- Updated dependencies [6b193ff]
- Updated dependencies [fb529a1]
  - @tyto/core@0.41.0

## 0.7.12

### Patch Changes

- Updated dependencies [6f4c86e]
- Updated dependencies [f658466]
- Updated dependencies [4a7c29d]
- Updated dependencies [8d081ec]
  - @tyto/core@0.40.0

## 0.7.11

### Patch Changes

- Updated dependencies [d2ca2f1]
  - @tyto/core@0.39.0

## 0.7.10

### Patch Changes

- Updated dependencies [b5d2c00]
  - @tyto/core@0.38.0

## 0.7.9

### Patch Changes

- Updated dependencies [6d363a3]
- Updated dependencies [7c650a4]
- Updated dependencies [d1cd8ba]
  - @tyto/core@0.37.0

## 0.7.8

### Patch Changes

- Updated dependencies [e94aa55]
  - @tyto/core@0.36.1

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
