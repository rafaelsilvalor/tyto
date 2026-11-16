---
'@tyto/brief-lang': minor
'@tyto/editor': minor
---

A `$…$` formula is coloured in the editor, part by part (TYTO-743): its text in the literal
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
