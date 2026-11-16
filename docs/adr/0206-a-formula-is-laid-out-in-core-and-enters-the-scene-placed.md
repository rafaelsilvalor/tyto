# 0206 — A formula is laid out in core and enters the Scene already placed

Status: accepted · 2026-11-15 · TYTO-678 · extends ADR 0168 (the face chain) and ADR 0169
(operators); beside ADR 0016, ADR 0109 and ADR 0205

The Scene, the layout and both exporters ship in TYTO-678. The brief syntax below ships in
TYTO-734; until then a formula reaches the Scene only from a template that builds the run.

## Context

Rafael, 2026-11-11, asked for exam answers written as on the reference:
`F = 1 / 40·10⁻³ = 25 Hz`, with the `1` stacked over `40·10⁻³` and a rule between them.
ADR 0168 and ADR 0169 settled math as plain Unicode on one baseline, and a text node can draw
nothing else: a `TextSpan` has no vertical offset, and nothing in core or brief-lang knows a
fraction (read on origin/main d52b7b7). Linear forms (`ω = 2πf`, `10⁻³` in Unicode
superscripts) already render; the stacked fraction is the gap.

Rafael chose our own layout over MathJax on 2026-11-11. MathJax draws in its own face, so a
formula would not match the text around it and a template's colour marks would not reach
inside; and its SVG carries `<use>`, `style` and `data-*`, which `checkSvgMarkup` refuses
(`packages/core/src/scene/svg-markup.ts`, ADR 0068).

## Decision

### Syntax (TYTO-734)

1. **A formula is written between two `$` on one line**: `$F = \frac{1}{40·10^{-3}} = 25\ Hz$`.
   Inside it, `\frac{numerator}{denominator}`, `^{superscript}` and `_{subscript}` are the
   only constructs; `^c` and `_c` with one character and no braces are the same as `^{c}` and
   `_{c}`. A group may hold any of them again (`\frac{1}{10^{3}}`).
2. **A `$` opens a formula only when the character after it is not a space, and closes one
   only when the character before it is not a space and the character after it is not a
   digit**, on the same line. That is Pandoc's rule, and it is what keeps money from turning
   into math: `R$ 50` and `de R$ 50 a R$ 60` hold no formula, and in `R$50 a R$60` the second
   `$` is followed by a digit, so it closes nothing. A `$` that opens or closes nothing is
   the plain `$` it is today.
3. **Inside a formula, `\` is the formula's, not the brief's.** The tokenizer takes the whole
   formula as one token, so neither the line break `\` (ADR 0016, ADR 0109) nor the escapes
   `\::` and `\//` (ADR 0204) apply between the two `$`. The formula has four escapes of its
   own: `\ ` (a space, for the LaTeX habit `25\ Hz`), `\$`, `\{` and `\}`. A `\$` never closes
   the formula. Outside a formula nothing about `\` changes.
4. **Spaces inside a formula are kept as written.** Briefs already write math with spaces
   around operators (ADR 0169), and LaTeX's own spacing rules would be a second typography to
   learn. A formula is one word for line breaking: it never breaks inside.
5. **Anything else is an error with a range, never a wrong drawing**: `E_FORMULA_COMMAND` for
   a `\name` that is not `\frac` (`\sqrt` is out of scope), `E_FORMULA_GROUP` for a missing
   or unclosed `{…}`, and `E_FORMULA_EMPTY` for `$$` or an empty group. The range is the
   characters at fault inside the formula. A formula that has an error is drawn as its source
   text, `$` included, so the author sees exactly what was not understood.

### Scene

6. **A formula is a run of its own**, `FormulaRun { kind: 'formula', text, math, font, size,
weight, style, color, layout? }`, beside `TextSpan` and `LineBreak`. `math` is the
   structure: `text`, `fraction { numerator, denominator }`, `scripts { superscript?,
subscript? }`, each holding a list of the same. A fraction is not a span with a vertical
   offset: two spans stacked in one horizontal slot cannot be said in a flow of spans without
   a negative advance, and both exporters would have to agree about it.
7. **`text` is the formula's linear reading**, `1/(40·10^(−3))` (`linearReading` in core). It
   was added while building: `kind === 'break' ? … : run.text` is how templates, the raster
   tests and `packages/templates` read runs, and a run without `text` would stop them
   compiling. With it they compile unchanged and read something sensible, the same reason the
   AST's `Formula` keeps `children` (decision 15). Nothing draws `text` except as the fallback
   of decision 13.
8. **`layout` is what `measureText` writes, and what the exporters draw**: the box (`width`,
   `ascent`, `descent`, px from the formula's baseline), a flat list of `glyphs` (`text`,
   `font`, `size`, `weight`, `style`, and `x`, `y`: the piece's baseline against the
   formula's origin, `y` down) and a list of `rules` (`x`, `y` of the top edge, `width`,
   `thickness`). Also `offset`, where the formula starts on its line, and `lineWidth`, the
   line's width, so `export-svg` places a formula and aligns a line holding one without
   measuring the text before it; and `above` and `below` (decision 11). An exporter positions
   what it is given and computes nothing, which is the hard rule that whatever must appear in
   the output enters the IR first.
9. **Glyphs come from the face chain of ADR 0168.** Each text piece of a formula is split by
   `coverRuns` exactly as a span is: the formula's own face first, then Noto Sans Math, then
   Source Sans 3. A formula is drawn in the template's face, and its `·`, `ω` and `⁻` fall
   back exactly as they do in prose.
10. **The geometry is fixed, in em of the formula's size** (`packages/core/src/text/formula.ts`):
    the math axis at 0.25 em above the baseline, a rule 0.06 em thick centred on it, 0.12 em
    clear between the rule and the ink of the numerator and of the denominator, the rule 0.1 em
    wider than the wider of the two on each side, both centred on it. Numerator and denominator
    keep the formula's size, as on the reference. Super- and subscripts are drawn at 0.7 of the
    size around them, raised 0.4 em or lowered 0.2 em, and 0.45 em and 0.25 em when both are
    present. Clearance is measured from the ink of the pieces (`Face.ink`, the glyph bounding
    box fontkit reads), not from the face's ascent, which would leave a fraction a line apart.
    A face's `MATH` table is not read: one fixed geometry for every face is reproducible by
    hand, and only Noto Sans Math has one. Letter spacing does not apply inside a formula.
    _2026-11-16 (TYTO-734):_ a fraction has no side bearing of its own. Measured on the
    reference brief at 40 px, the ink of the `=` before it is 8 px from the rule and the rule
    9 px from the `=` after it; 0.12 em on each side (13 px and 13 px) was proposed, and
    Rafael kept the geometry as it is.
11. **A line holding a formula is as tall as it needs to be.** A line's box is the strut,
    grown to hold the box of every formula on it, as a CSS line box grows to hold an
    inline-block. The strut is split as Chromium splits it: the reference face's ascent and
    descent rounded to whole pixels, and half the leading, truncated toward zero, above the
    ascent. Measured before that rounding was in: Source Sans 3 at 40 px on a 56 px line puts
    its baseline 41 px down, where the unrounded split said 40.48. Layout adds the growth to
    the measured height and writes it on every formula of the line as `above` and `below`.
    `export-svg` moves the line's baseline down by `above` and the next line's by `below`;
    `export-html` draws the formula as an inline-block of exactly its box, and the browser's
    line box grows by the same amount. A paragraph's `space` (ADR 0205) is added as before, on
    top. Template-kit's rhythm reads the measured height, so it spaces a block holding a
    fraction by its real height with no rule of its own; its `rebreak` reads a formula as one
    character that is not a space (U+FFFC), so it never breaks inside one either.
12. **Exporters draw the placed pieces.** `export-svg` writes the line's text with the text
    after a formula moved on by its width (`dx`), then one `<text>` per piece and one `<rect>`
    per rule at the IR's coordinates. `export-html` writes an inline-block span the size of the
    box with `vertical-align: -descent`, holding an inline `<svg>` whose origin is the baseline,
    with the same `<text>` and `<rect>` elements, in the document's `@font-face` families. A
    formula painted with a gradient or an image is drawn in one solid colour in HTML and warns
    `W_EXPORT_APPROXIMATED`; the SVG paints it as it paints a span.
13. **A formula that could not be laid out** (a node in a face no source holds, the case in
    which `measureText` keeps the brief's lines) has no `layout`, and both exporters draw its
    `text` in the run's style. `compile` already reports that face as
    `E_FONT_FACE_UNAVAILABLE` (ADR 0110), so no new diagnostic is needed.
14. **Core checks what a formula draws in.** `parseScene` requires every face a formula's
    pieces name in `Scene.fonts` (`E_SCENE_FONT_NOT_DECLARED`), `compile` declares them, and
    `sceneResources` asks the font source for them. A node holding only a formula is not an
    empty text.

### Compatibility

15. **The AST gains `Formula { kind: 'formula', source, math, children, range }`
    (TYTO-734).** `children` is the formula's linear reading as plain text, so every traversal
    that reads a rich-text value through `children` (`plainText` in `resolve`, `plain` in
    template-kit, `plainTextOf` in template-lang, `plain` in the CLI's plugin skeleton, and the
    same pattern in templates in their own repositories) keeps compiling and reads
    `F = 1/(40·10^(−3)) = 25 Hz`.
16. **`runsOf` turns a `Formula` into a `FormulaRun`** in the style around it, bold, italic and
    marks included, so `{cor:roxo}$x^2${/}` colours the whole formula (TYTO-734).

## Consequences

- The reference answer renders stacked in HTML, SVG and the raster that comes from the HTML,
  from a Scene: `packages/export-html` and `packages/export-svg` each keep a fixture laid out
  by core with the bundled Source Sans 3 and a snapshot of it. A brief can write it once
  TYTO-734 lands.
- Measured in Chromium on the two snapshots: every piece and the rule sit at the same `x` in
  HTML and SVG within 0.01 px. Vertically the HTML is 0.99–1.00 px lower everywhere, the same
  0.996 px a plain line with no formula shows; that is `export-svg`'s fixed ascent stand-in
  (0.8 em), older than this ADR. The HTML rule's top sits where layout predicts it, within
  0.01 px.
- `TextRun` gains a member. A template that switches on `run.kind` exhaustively stops compiling
  against the new core until it handles `formula`; one that tests `kind === 'text'` skips
  formulas, and one that reads `run.text` after excluding breaks reads the linear reading.
  `@tyto/core` takes a minor bump and its changeset says so.
- `referenceRun` in `@tyto/core` may now return a `FormulaRun`, whose size is the strut's like
  a span's.
- The editor does not highlight the syntax: `packages/editor` is another card's.
- `\sqrt`, matrices, aligned systems and integrals with limits stay out (TYTO-678's scope).
  Centring a formula on a line of its own is the template's choice.
- A formula never breaks. One wider than its box overflows, and is reported as any other
  overflow.
- Text as paths (`export-svg --text-as-paths`) outlines a formula's pieces as it outlines a
  span, and draws its rules as `<rect>`.

## Rejected

- **MathJax**, see Context.
- **Spans with a vertical offset and a rule run.** Enough for a superscript, not for a
  fraction: the numerator and the denominator share a horizontal slot.
- **Laying the formula out in each exporter.** Two layouts that must agree, and an SVG
  exporter that would need face metrics it does not have.
- **`\(…\)` as the delimiter.** `\(` is a line break followed by `(` today (ADR 0016), so it
  would change what existing briefs mean; `$` with Pandoc's rule changes nothing that holds
  money.
- **Positioning the formula's pieces in HTML with absolutely placed spans.** A span's baseline
  inside its box depends on the face's metrics again; an inline `<svg>` puts each piece on the
  baseline the IR gives, as the SVG exporter does.

## Note, 2026-11-16 — the syntax as built (TYTO-734)

The syntax shipped as decisions 1 to 5 say. Where building it had to choose, it chose this:

- **`Formula.source` is the formula as written, both `$` included**, and its `children` are
  `linearReading(math)` as one `Text`: `F = 1/(40·10^(-3)) = 25 Hz`. The `-` stays the
  hyphen the brief wrote; decision 15's `−` was the U+2212 TYTO-678's hand-built fixture
  used. Nothing in a formula turns `-` into a minus sign.
- **A bare group, `${a}$`, is `E_FORMULA_GROUP`.** A group belongs after `\frac`, `^` or
  `_`; LaTeX's invisible grouping would draw nothing here, so it is refused rather than
  dropped. `\` before anything that is not a letter or one of the four escapes (`\,`) is
  `E_FORMULA_COMMAND`, the same as an unknown name.
- **One error per formula.** The first is reported; after it the reader is guessing, and
  `\frac{}{2}` read on past the empty group would also call `{2}` a group out of place.
- **A glyph is one word (decision 8).** `layoutFormula` places each run of non-space
  characters of a text piece at the advance of what comes before it, and draws no space.
  Measured in Chromium on the reference brief, the ` = 25 Hz` after the fraction sat 1 px
  from the rule in HTML and 9 px from it in SVG: an HTML document drops the leading space of
  an SVG `<text>` (`white-space: pre` on the `<svg>` did not keep it). With one word per
  glyph both exporters draw the same columns. Widths and the line's layout are unchanged:
  the piece's advance is still measured whole.
- **Pandoc's rule pairs two prices spaced differently.** In `R$50 e R$ 60` the first `$` has
  a digit after it and the second a letter before it and a space after, so the two make the
  formula `$50 e R$`. That is decision 2 read literally, and Pandoc reads it the same way;
  the manual tells authors to write every price of a line the same way.
