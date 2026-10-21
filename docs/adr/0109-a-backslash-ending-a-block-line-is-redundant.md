# 0109 — A `\` ending a block line before another one is redundant: dropped, and warned

Status: accepted · 2026-10-20 · TYTO-330 · beside ADR 0016, ADR 0087 and ADR 0096

## Context

A `\` is a hard line break (`docs/brief-language.md`, ADR 0016 for the IR side), and the
boundary between two lines of an indented block is a `Break` too: the author wrote two lines
and means two lines. Nothing stopped the two from meeting. Measured on origin/main on
2026-10-20: `::t` with the block `a\` / `b` parsed to `text, break, break, text`, which is an
empty line in the artwork. The same happened when an inline head ended in `\` and a block
followed it. The TYTO-316 executor found it while writing the manual, which does not teach `\`
for that reason, and the language doc calling `\` "line break" reads as though a block line
needs one.

An author who writes `\` at the end of a block line is almost always telling the line to break
— which it already does — not asking for the empty line it produced.

## Decision

1. **One `\` that ends a line, with a further body line after it, is dropped.** "Ends a line"
   means it is the last inline of the line at the top level of the body: the inline head, or a
   line of the block. `parseBrief` drops it when it pushes the `Break` for the next line, and
   tells it apart from that boundary's own `Break` by the source character its range covers
   (`\`, where a boundary covers the line ending).
2. **Each drop reports `W_REDUNDANT_BREAK`**, a warning (not fatal, ADR 0013), with the range
   of the dropped `\`: "Every line of an indented block already starts a new line; this `\` is
   not needed." The author who wrote it for the empty line it used to make is told, and the
   Problems panel points at the character to delete.
3. **`\\` still gives one empty line.** Only one `\` is dropped, the last; the other is one
   break more than the block gives, which is a choice an author can make on purpose. It warns
   once.
4. **Nothing changes where the `\` is the only break.** In the middle of a line, at the end of
   an inline body with no block under it, and on the last line of a block, a `\` breaks the line
   as before and nothing is reported.
5. **Spaces before a dropped `\` go with it.** ADR 0096 kept them because they sat inside the
   line, before markup; once the `\` is gone they are the end of the line, and the trim reruns.
6. **The highlighter and Format Brief are untouched.** The `\` is still a `Break` token, and
   ADR 0096 holds: Format Brief changes nothing inside a line, so it does not delete the `\`. The
   warning is how the author learns, and the delete is theirs.

## Consequences

- A brief that had a `\` at the end of a block line renders one empty line shorter, and shows a
  warning where it used to compile silently. That is the fix; the changesets say so.
- A `\` nested inside bold, italic or a mark at the end of a line (`**a\**`) is not the last
  inline at the top level and is left alone: it still adds an empty line, without a warning.
  Nobody has been seen writing it, and the rule stays one sentence long.
- Guarded by `packages/brief-lang/src/redundant-break.test.ts` (LF and CRLF) and, through a
  built-in template, by `tools/contract-test/src/built-in-templates.test.ts`: the brief with the
  `\` compiles to the same Scene as the brief without it.
