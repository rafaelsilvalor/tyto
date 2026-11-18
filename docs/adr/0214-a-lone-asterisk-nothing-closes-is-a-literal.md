# 0214 — A lone asterisk nothing closes is a literal

Status: accepted · 2026-11-18 · TYTO-775 · amends ADR 0015

## Context

The brief language has no escape for `*`. Every `*` was an italic mark, so a `*` with no partner
was `E_SYNTAX`, "an italic run is missing its closing *", and nothing rendered. On 2026-11-18 a
table request wrote a salary as `R$ 4.143,06*` and closed the table with its footnote,
`*SEDUC AM: valores de referência…`: the house's ordinary way of marking a note, and two syntax
errors. Asking authors to write `\*` would make them learn an escape for the one thing the
asterisk means in print outside Markdown.

## Decision

**A lone `*` that nothing on its line closes is the character itself**, a `LiteralStar` node the
AST carries as text. Lone means neither neighbour is another `*`; `**` stays bold's.

Whether a `*` closes something needs the rest of its line, so an external tokenizer in
`tokens.ts` decides, as it does for a formula's `$` (ADR 0206). An italic run never crosses a
line, so the line is enough:

- the lone stars before it on the line are counted; an odd count means one is open and this one
  closes it — the grammar's `italicMark`;
- an even count means it would open a run, and it does only when another lone star comes later on
  the line; otherwise it is `LiteralStar`.

So `*itálico*` is what it always was, `R$ 4.143,06*` and `*Nota` are text, and in
`*nota* importante*` the first two make italic and the third is the character.

`Break` in the AST also gains `typed?: true`, set on a `\` the author wrote, absent on the
boundary between two block lines. A template that reads each block line as a record — the
one-image table's rows — needs to tell a break inside a record from the end of one; every other
template draws both the same, as before.

## Consequences

- A brief that failed with one unpaired `*` now renders. No brief that parsed before parses
  differently: a `*` that had a partner on its line still pairs.
- `**bold *italic***` still does not parse (ADR 0015's limit), and recovery now leaves one error
  node at the end of the line instead of four.
- Stars inside a formula earlier on the same line are counted too; a formula holding a lone `*`
  beside a literal one on one line is not untangled.
- `writeBrief` no longer refuses a value for an unpaired `*`; it still refuses one that does not
  parse back.
