---
'@tyto/core': minor
'@tyto/export-html': minor
'@tyto/export-svg': minor
'@tyto/template-kit': patch
---

TYTO-678: a text node can draw a formula with a stacked fraction, superscripts and subscripts
(ADR 0206). `TextRun` gains `FormulaRun { kind: 'formula', text, math, font, size, weight,
style, color, layout? }`; `text` is the linear reading, so code that reads `run.text` after
excluding breaks keeps compiling. A template that switches on `run.kind` exhaustively must
handle `formula`. `measureText` lays a formula out with a fixed geometry, its glyphs through
the ADR 0168 face chain, keeps it whole on a line and makes its line taller by what the
formula reaches past the strut; `layoutFormula` and `linearReading` are exported, and `Face`
gains optional `ascent`, `descent` and `ink`. `referenceRun` may return a formula. Both
exporters draw the placed pieces and rules: `export-html` as an inline-block holding an inline
`<svg>`, `export-svg` as `<text>` and `<rect>` with the line's text moved past the formula.
Template-kit's `rebreak` never splits a formula. The brief syntax ships in TYTO-734.
