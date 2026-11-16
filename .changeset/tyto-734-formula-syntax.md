---
'@tyto/brief-lang': minor
'@tyto/core': minor
'@tyto/plugin-api': patch
'@tyto/raster': patch
---

A brief writes a formula between two `$`: `$F = \frac{1}{40·10^{-3}} = 25\ Hz$` draws a
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
