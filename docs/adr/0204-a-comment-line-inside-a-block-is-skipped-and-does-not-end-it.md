# 0204 — A comment line inside a block is skipped and does not end it

Status: accepted · 2026-11-15 · TYTO-680 · extends ADR 0087 · beside ADR 0202

## Context

The grammar had `line { Comment | Directive | BlankLine }`: a comment was a top-level line and
nothing else. Measured on origin/main on 2026-11-15 with `parseBrief`, a `::lamina {resposta}`
whose body is `O período é o dobro.`, a comment `//::imagem {sem-quadro} formula.png`, then
`T = 40 ms` and `f = 25 Hz`:

| The comment         | Lines after it | What `parseBrief` returned                                             | Diagnostics                                                                                      |
| ------------------- | -------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| at column 0         | two spaces     | `lamina` with the first line; a directive `T` with `= 40 ms⏎f = 25 Hz` | `E_SYNTAX` "an indented line must follow a directive", `E_SYNTAX` "this directive is incomplete" |
| at column 0         | one space      | the same                                                               | the same                                                                                         |
| indented two spaces | two spaces     | `lamina` with every line                                               | `E_SYNTAX` "unexpected '//::imagem {sem-quadro} …'"                                              |
| none (control)      | two spaces     | `lamina` with every line                                               | none                                                                                             |

The card adds `E_UNKNOWN_SLOT 'T'` on the first two rows, which `resolve` reports for the
recovered directive.

A comment at column 0 closed the block, as ADR 0087 decision 2 says a block ends: at the next
line that is not blank and starts back at column 0. An indented `//` was body text, and here a
broken one. Commenting out a line in the middle of a slide — the most common use of a comment —
lost the rest of the slide.

## Decision

1. **A comment line inside a block is skipped, and the block goes on.** It means nothing, the
   way a blank line means nothing (ADR 0087); the brief compiles to the Scene it would compile
   to without it.
2. **An indented `//` line is always a comment of the block it is in**, at any indent, even as
   the block's last line.
3. **A `//` at column 0 belongs to the block when the block goes on after it**: the next line
   that is neither blank nor another column-0 comment is indented. Otherwise the block ends
   before it and it is a top-level comment, as before — so a note written above a directive
   belongs to no block. This amends ADR 0087 decision 2: a block ends at the next line, back at
   column 0, that is neither blank nor a comment followed by more of the block.
4. **A body line that really starts with `//` is written `\//`**, which reads as `//`. It
   follows `\::`, the escape the language already has, rather than a general escape rule.
   `writeBrief` writes it for a value line that starts with `//`, as it writes `\::`.
5. **Format Brief indents a comment line inside a block like the body lines** (ADR 0096), so a
   column-0 one between two body lines is drawn inside its block. A top-level one stays at
   column 0.

## Consequences

- The grammar gains `commentBreak`, the line break, blank lines and indent in front of the `//`,
  from an external tokenizer (`commentsInBlocks` in `tokens.ts`), because decision 3 depends
  on lines past the token and a Lezer token has no lookahead. The `Comment` after it is the
  same token a top-level comment is, so it is coloured the same with no new rule, and it is a
  child of the `Directive`.
- The editor reads it as the block's: a fold and a block's range (`briefBlocks`) run to a
  comment line at the block's end, and completion offers nothing in the indent in front of one.
- ADR 0202 makes a column-0 text line continue the block above (TYTO-708). When that lands,
  "indented" in decision 3 becomes "a line that is not a directive"; the tokenizer's lookahead
  is where that changes.
- A brief that relied on an indented `//` being text now loses that line silently. ADR 0202
  counted 0 of 405 `.brief` files on the maintainer's machine with an indented `//`; briefs on
  other machines were not measured.

## Note, 2026-11-16 — a column-0 text line continues the block (TYTO-708, ADR 0202)

A text line at column 0 is now a body line of the directive above, so "the block goes on" no
longer needs an indent. Decision 3 reads: a `//` at column 0 belongs to the block when the next
line that is neither blank nor another column-0 comment is not a `::` directive. `::lamina` /
`// x` / `Texto` is one lamina with the body `Texto`, and the comment is the lamina's; a
column-0 comment followed by a directive, or by nothing but blank lines to the end of the
file, is still a top-level comment. The change is in `blockGoesOn`, the lookahead of
`commentsInBlocks` in `tokens.ts`. Decisions 1, 2, 4 and 5 stand.
