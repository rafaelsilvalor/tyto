# 0206 — A formula is laid out in core and enters the Scene already placed

Status: proposed · 2026-11-15 · TYTO-678 · extends ADR 0168 (the face chain) and ADR 0169
(operators); beside ADR 0016, ADR 0109 and ADR 0205

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

### Syntax

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

6. **A formula is a run of its own**, `FormulaRun { kind: 'formula', math, font, size,
weight, style, color, layout? }`, beside `TextSpan` and `LineBreak`. `math` is the structure
   (`text`, `fraction { numerator, denominator }`, `scripts { superscript?, subscript? }`, each
   holding a list of the same). A fraction is not a span with a vertical offset: two spans
   stacked in one horizontal slot cannot be said in a flow of spans without a negative
   advance, and both exporters would have to agree about it.
7. **`layout` is what `measureText` writes, and what the exporters draw**: `width`, `ascent`
   and `descent` of the formula's box in px from its baseline, a flat list of `glyphs`
   (`text`, `font`, `size`, `weight`, `style`, `x`, `y`, the baseline of each piece relative
   to the formula's origin) and a list of `rules` (`x`, `y`, `width`, `thickness`). An
   exporter positions what it is given and computes nothing, which is the hard rule that
   whatever must appear in the output enters the IR first.
8. **Glyphs come from the face chain of ADR 0168.** Each text piece of a formula is split by
   `coverRuns` exactly as a span is: the formula's own face first, then Noto Sans Math, then
   Source Sans 3. A formula is drawn in the template's face, and its `·`, `ω` and `⁻` fall
   back exactly as they do in prose.
9. **The geometry is fixed, in em of the formula's size**: the math axis at 0.25 em above the
   baseline, a rule 0.06 em thick centred on it, 0.12 em clear above and below the rule, the
   rule 0.1 em wider than the wider of numerator and denominator on each side, both centred
   on it. Numerator and denominator keep the formula's size, as on the reference.
   Super- and subscripts are drawn at 0.7 of the size around them, raised 0.4 em or lowered
   0.2 em, and 0.45 em and 0.25 em when both are present. Clearance is measured from the ink
   of the pieces (`Face.ink`, the glyph bounding box fontkit reads), not from the face's
   ascent, which would leave a fraction a line apart. A face's `MATH` table is not read: one
   fixed geometry for every face is reproducible by hand, and only Noto Sans Math has one.
10. **A line holding a formula is as tall as it needs to be.** A line's box is the strut
    (`lineHeight × the node's largest run`, centred on the face's ascent and descent the way
    CSS centres it) grown to hold the box of every formula on it. Layout adds the growth to
    the measured height; `FormulaRun.layout` carries `above` and `below`, the px its own box
    reaches past the strut, and `export-svg` moves the line's baseline down by the largest
    `above` and the next line's by the largest `below`. `export-html` draws the formula as an
    `inline-block` of exactly that box, so the browser's line box grows by the same amount.
    A paragraph's `space` (ADR 0205) is added as before, on top. Template-kit's rhythm reads
    the measured height, so it accounts for the taller line with no change of its own.
11. **Exporters draw the placed pieces.** `export-svg` writes one `<text>` per glyph piece at
    its `x`/`y` and one `<rect>` per rule, after the line's text. `export-html` writes an
    inline-block span of the box's size with `vertical-align: -descent`, holding an inline
    `<svg>` with the same `<text>` and `<rect>` elements, in the document's `@font-face`
    families. Both draw the same coordinates.
12. **A formula that could not be laid out** (a node whose face no source holds, the case in
    which `measureText` keeps the brief's lines) has no `layout`, and both exporters draw its
    linear reading, `1/(40·10⁻³)`, in the run's style. `compile` warns with
    `W_FORMULA_NOT_LAID_OUT`.

### Compatibility

13. **The AST gains `Formula { kind: 'formula', source, math, children, range }`.**
    `children` is the formula's linear reading as plain text, so every traversal that reads a
    rich-text value through `children` (`plainText` in `resolve`, `plain` in template-kit,
    `plainTextOf` in template-lang, `plain` in the CLI's plugin skeleton, and the same pattern
    in templates in their own repositories) keeps compiling and reads `F = 1/(40·10⁻³) = 25 Hz`.
14. **`runsOf` turns a `Formula` into a `FormulaRun`** in the style around it, bold, italic and
    marks included, so `{cor:roxo}$x^2${/}` colours the whole formula.

## Consequences

- A brief can write the reference answer, and it renders stacked in HTML, SVG and the raster
  that comes from the HTML.
- `TextRun` gains a member. A template in its own repository that switches on `run.kind`
  exhaustively stops compiling against the new core until it handles `formula`; one that tests
  `kind === 'text'` skips formulas. `@tyto/core` takes a minor bump and the changeset says so.
- The editor does not highlight the new syntax yet: `packages/editor` is another card's.
- `\sqrt`, matrices, aligned systems and integrals with limits stay out (TYTO-678's scope).
  Centring a formula on a line of its own is the template's choice.
- A formula never breaks. One wider than its box overflows, and is reported as any other
  overflow.

## Rejected

- **MathJax**, see Context.
- **Spans with a vertical offset and a rule run.** Enough for a superscript, not for a
  fraction: the numerator and the denominator share a horizontal slot.
- **Laying the formula out in each exporter.** Two layouts that must agree, and an SVG
  exporter that would need face metrics it does not have.
- **`\(…\)` as the delimiter.** `\(` is a line break followed by `(` today (ADR 0016), so it
  would change what existing briefs mean; `$` with Pandoc's rule changes nothing that holds
  money.
