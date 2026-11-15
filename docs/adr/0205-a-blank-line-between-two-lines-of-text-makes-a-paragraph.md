# 0205 — A blank line between two lines of text makes a paragraph, and the template sets its space

Status: accepted · 2026-11-15 · TYTO-557 · supersedes ADR 0087 decision 1 · beside ADR 0016, ADR 0204

## Context

Rafael, 2026-11-02, asked whether paragraphs can vary their spacing. Read in the code on
origin/main: there was no paragraph to space. A `TextRun` is a span or a `LineBreak` with no
fields (ADR 0016); `lineHeight` is one number per text node, and every line advances by it
(`packages/core/src/text/layout.ts`). ADR 0087 decided that a blank line inside a block has no
meaning, and said a paragraph "needs syntax of its own". Today's way to leave room between two
groups is `\\`, a whole empty line: the room is always one line advance, and the brief says how
it looks rather than what it is.

ADR 0087 was written for the agendas: two disciplines with a blank line between them, which
used to end the block and lose the second group. Those briefs are the ones a change to blank
lines must not move.

## Decision

Rafael, 2026-11-02, closed:

1. **A blank line between two lines of text makes a paragraph.** One or several in a row, empty
   or holding only spaces and tabs, are one paragraph boundary. This replaces ADR 0087 decision
   1 ("a blank line has no meaning") for the blank lines between two lines of text; every other
   decision of ADR 0087 stands — a blank line still never ends a block.
2. **A blank line at the start or the end of a block means nothing**, as before: there is no
   second line for it to separate. That covers the blank lines between a head with no text and
   its first body line (ADR 0087 decision 3) and the ones a block absorbs before the next
   directive.
3. **A head with text of its own is a line of text.** `::lamina Um`, a blank line, then `  Dois`
   is two paragraphs, so Format Brief keeps that blank line where it drops the one under a head
   with no text.
4. **A comment line is not a blank line.** It is skipped as if it were not there (ADR 0204): a
   comment between two lines makes no paragraph, and a blank line beside one still does.
5. **The template sets the space, and the default is 0.** The parser marks the `Break` it already
   emits for the boundary with `paragraph: true`. `runsOf` takes `paragraphSpacing` (px) and gives
   that break `space` in the Scene; template-kit's `TextStyle` carries it to `runsOf`. A template
   that declares nothing, or 0, gets the plain `{ kind: 'break' }` it got before — the same Scene,
   byte for byte, so every exporter draws the same pixels.
6. **The Scene carries the space, and only a positive one.** `LineBreak` gains an optional
   `space`, px added between the line it ends and the next, on top of the line advance (ADR
   the hard rule that an exporter sees only the Scene). Layout adds it to the measured height,
   keeps it on the break it came on through a wrap, and scales it with `overflow: 'shrink'`.
   `export-html` draws it as an empty block of that height after the `<br>`; `export-svg` moves
   the next baseline down by it.

## Why the agendas keep working

An agenda with a blank line between two groups now parses to the same lines with one break
marked `paragraph`. No template declares `paragraphSpacing` today, so `runsOf` writes that break
as the plain `LineBreak` it wrote before, and the Scene is identical to the one the same brief
compiled to under ADR 0087. `packages/template-kit/src/paragraphs.test.ts` compiles the agenda
with and without its blank line through the real `parseBrief` → `resolve` → `compile` → both
exporters and requires the Scene, the HTML and the SVG to be equal. A template that wants the
groups apart now has a number to set instead of an empty line to ask the author for.

## Consequences

- `Break` in the AST and `LineBreak` in the Scene each gain one optional field; no new kind, so
  every `switch` on `kind` — in this repository and in templates in their own — compiles as it
  did.
- `writeBrief` keeps a run of blank lines between two lines of a value as one blank line, since
  it now says something; blank lines at either end of a value are still dropped (ADR 0172).
- A plugin's `ExpandedInline` break has no `paragraph` flag: a plugin directive cannot write a
  paragraph yet.
- A markup template (`template.html`) cannot set the space yet: `@tyto/template-lang` calls
  `runsOf` without `paragraphSpacing`, so its paragraphs are drawn at 0. A CSS property for it
  is the follow-up; until then a markup template draws exactly what it drew before.
- First-line indent and every other paragraph style stay out (TYTO-557's scope).
