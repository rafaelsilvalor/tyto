# 0197 — Indentation in a brief is visual, and nesting comes from the manifest

Status: accepted · 2026-11-13 · TYTO-708, TYTO-709 · extends ADR 0004 and ADR 0087 · builds on
ADR 0160 (`per`) and ADR 0096 (Format Brief)

## Context

ADR 0087 made the width of an indent meaningless: two spaces, six or a tab all make a body
line. Its presence still means something, and that is what a newcomer trips on. Measured on
2026-11-13 with `parseBrief` (the grammar has not changed since #129):

```brief
::lamina
Linha um
Linha dois
```

gives an empty `lamina`, an invented directive `::Linha` with body `um`, and three `E_SYNTAX`.
The same lines indented give one `lamina` with the body `Linha um⏎Linha dois`.

The indent carries exactly one bit today: "this line is text, not a directive". Two cases
follow from it:

- **A text line at column 0** is a syntax error. Accepting it changes the meaning of no valid
  brief.
- **An indented line starting with `::`** is literal text: `::lamina` / `  Linha um` /
  `  ::imagem ./a.png` is one lamina whose body ends in `::imagem ./a.png`. An indented `//`
  is an `E_SYNTAX`. Measured on 2026-11-13: 0 of 405 `.brief` files under the maintainer's
  projects folder have either; briefs on other machines were not measured.

Nesting does not depend on indentation either: a `per: lamina` slot belongs to the slide
written last before it, at column 0 (ADR 0160).

Rafael, 2026-11-13: indentation should be visual — it stays on screen when a person writes
it and is ignored when the artwork is made, so a newcomer need not think about it and a
practised author can still use it. He also wants tags that work only inside a slide or a block
to be written inside it, more than one level deep, which opens paragraphs and other text
structure.

## Decision

1. **Indentation never changes what a brief compiles to.** Present or absent, two spaces or a
   tab, a brief compiles to the same Scene. The editor shows the indent the person wrote.
2. **A text line at column 0 is a body line of the directive above** (TYTO-708). A line that
   starts with neither `::` nor `//`, and is not blank or frontmatter, continues the block above
   it exactly as an indented line does. Text before the first directive is still an error.
   A column-0 line that starts with a single `:` is read as text and warned about, because it
   is most likely a mistyped directive and must not go silent.
3. **Which directive sits inside which is the manifest's to say, never the indent's**
   (TYTO-709). A slot declares its parent, generalising `per`, to any depth; a directive
   belongs to the nearest open occurrence of its parent above it. With this, an indented `::`
   is a directive like one at column 0, and a literal `::` in text is written `\::`, the escape
   the language already has.
4. **No setting changes the language.** A brief is a file that runs in the window, the CLI, the
   MCP server and on other people's machines; a setting that made indentation count would make
   one file compile differently in two places. A stricter habit, if wanted, is an editor
   warning that never touches the Scene.
5. **Format Brief draws the structure.** It already indents body lines to `tabSize` (ADR 0096);
   it indents a column-0 body line the same way, and, once slots declare parents, each
   directive by its depth in the manifest's tree. Nobody has to count spaces to see the
   nesting.

## Consequences

- TYTO-708 adds a body-line break for a column-0 text line to the grammar, through an external
  tokenizer in `tokens.ts` (a Lezer token cannot look at the rest of the line). The editor
  pieces that read indentation — Enter, indent guides, folds, `briefBlocks`, sticky scroll,
  completion, vim text objects — are checked against the unindented line in the same card.
- TYTO-709 changes the meaning of an indented `::` from text to directive. That is the one
  place this ADR can change a brief that compiles today; the count above is why it is accepted,
  and the card's changeset says so.
- Left to TYTO-709: whether the manifest key is `per:` extended or a new `parent:`, and how a
  template receives the tree if `context.slots` stops being flat (a protocol bump).
- Paragraphs stay open. ADR 0087 decided a blank line means nothing; a paragraph is either a
  nested directive such as `::paragrafo`, which this ADR makes possible, or a new ADR that
  reopens 0087.
- On screen, a wrapped line keeps its indent on every visual row (TYTO-707). That is the
  editor's alone and needs no decision here; it is named because it is what makes the indent
  worth keeping when it no longer means anything.
- `docs/brief-language.md`, the manual in both editions and the brief-modeller skill still
  teach that a body line is indented; each card updates them as it lands.
