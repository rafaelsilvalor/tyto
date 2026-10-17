# 0087 — A blank line has no meaning and does not end an indented block

Status: accepted · 2026-10-16 · TYTO-294 · beside ADR 0004 and ADR 0016

## Context

`docs/brief-language.md` said a blank line ends an indented block. That was a fact about the
grammar, not a decision anybody made: `blockIndent` was the line break plus the indent as one
token, and after a blank line the character behind the break is another break. A person writes
a `::lamina` the way the agendas arrive, a blank line between two disciplines:

```brief
::lamina
      ORTOPEDISTA
      10-09 - 20h | Cuidado dos pés 1. | Profª. Mara Rebeiro

      ORTOPEDISTA
      11-09 - 20h | Cuidado com a coluna 1. | Profª. Mara Rebeiro
```

Measured on origin/main on 2026-10-16: the lamina ended at the blank line, and the indented
text after it was recovered as a directive of its own named `ORTOPEDISTA`. The compiled Scene lost the second group without a fatal error; the contract test
added here shows the missing `"text": "ORTOPEDISTA"` when run against the old grammar.

Rafael, 2026-10-16: the language ignores blank lines — one or several in a row — inside an
indented block. They exist only to help a person read.

## Decision

1. **A blank line has no meaning.** Inside a block, one or any number of blank lines in a row,
   empty or holding only spaces and tabs, change nothing: the brief compiles to the Scene it
   would compile to without them. `blockIndent` is now `lineBreak ($[ \t]* lineBreak)* $[ \t]+`,
   so the indent of the next line with text takes every blank line in front of it.
2. **A block ends only at the next non-blank line back at column 0.** A blank line between a
   block and the next directive is still a blank line at the top level, so a directive after
   any number of them is a directive.
3. **Between the head and the first body line, a blank line is body, and is ignored.**
   `::lamina` then a blank line then the indented lines is the same lamina.
4. **A line holding only spaces is blank at the top level too.** An external tokenizer
   (`blankLines` in `tokens.ts`) takes a whole run of blank lines as one token, because only the
   end of the line tells a line of spaces from an indent with no directive above it — which is
   still an error, still reported at the indent. It is declared ahead of `@tokens`: declared
   after, it never fired.
5. **Ranges never point at blank padding.** A directive's range ends at its last line with text,
   not on the blank lines its block absorbed. The `Break` between two lines stays on the line
   break the first one ends with. A line of spaces inside a block is a `BodyLine` with no text,
   and `parseBrief` drops it rather than emit a `Break` for it.

## Consequences

- A blank line inside a block can no longer mean anything, now or later: a "paragraph" in a
  block, if a template ever wants one, needs syntax of its own (a trailing `\` already makes a
  line break, ADR 0016).
- The tree changes shape where blank lines are: a `BodyLine` may start several lines above its
  text, and a top-level `BlankLine` may cover several lines. Nothing in `parseBrief` or the
  exporters reads those positions; the editor's fold range does, and is left as it is in this
  change (TYTO-294's Left open).

## Note, 2026-10-16 — Enter in the editor (TYTO-305)

The typing side of this decision, in `@tyto/editor` only; nothing the language decides changes.
Rafael chose it on 2026-10-16 (option "c"). In a brief, outside the frontmatter: Enter on a line
with text opens a line at that line's indent; Enter on a blank line after a line with text keeps
the blank line, emptied, and the new line takes that line's indent, so one blank line separates
two groups and typing goes on aligned; Enter on a blank line after a blank line adds no line and
puts the current one back at column 0, where the next directive starts. Blank is what this ADR
says it is: empty, or spaces and tabs only. Measured before the change, in jsdom: CodeMirror's
default Enter put every new line of a brief at column 0, because the syntax tree has no indent
rule and answers 0. Shift+Enter, Tab and Shift+Tab are unchanged, an open completion list still
takes Enter, and JSON tabs and template buffers keep CodeMirror's Enter: a template is markup
and CSS, whose nesting the second-blank-line rule does not describe.
