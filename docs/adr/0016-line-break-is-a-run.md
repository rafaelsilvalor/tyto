# 0016 — A line break is a run, not a character

Status: accepted · 2026-09-07 · extends the Text node of ADR 0003

## Context

The brief language has two ways to break a line: a trailing `\`, and the boundary between two lines of an indented block. `parseBrief` (E3.2) emits `{ kind: 'break' }` for both. The Scene IR had nowhere to put either.

A `TextNode` was `runs: TextRun[]` plus `align`, `valign`, `lineHeight`, `letterSpacing` and `overflow`, and a `TextRun` was `{ text; font; size; weight; style; color; decoration? }`. No break, no `<br>`, nothing. The only place a break could have lived was as a `\n` inside `TextRun.text`, and that is the option this ADR rejects.

It blocks E4.2: `compile` turns a `RichText` into runs and has no target for a `break` inline.

Three options were on the table.

**(a) `\n` inside `TextRun.text`.** No schema change, and every exporter then has to scan the string for it — which is what `docs/ir-schema.md` already forbids, in as many words: _"Colour is structured, not a CSS string. Exporters must never parse."_ The rule exists because two exporters that each parse the same string will eventually disagree about it. And scanning buys nothing: SVG 1.1 has no automatic line breaking, so `export-svg` has to split the text into positioned `<tspan>` elements regardless. Scanning is not a shortcut past that work, it is that work done in the wrong place, once per exporter.

**(b) A tagged union of runs.** `TextRun` becomes `{ kind: 'text', … } | { kind: 'break' }`. It follows the convention the IR already states — _"`kind` tags every node and every union member"_ — and it lets a visitor dispatch instead of scan. Every consumer of `runs` gains one case.

**(c) `Text.lines: TextRun[][]`.** Structurally unambiguous, and it fights everything else about the node: automatic wrapping produces lines the IR did not declare, `align` applies across them, and `E4.5`'s measurement would have to reconcile declared lines with laid-out ones. It is also the largest schema change of the three.

## Decision

**(b).** `textRunSchema` is a discriminated union on `kind`:

```ts
TextRun = TextSpan { kind: 'text'; text; font; size; weight; style; color; decoration? }
        | LineBreak { kind: 'break' }
```

A `LineBreak` carries no styling. It has no glyph, so it has no font, size or colour to have; the runs around it decide what the line it ends looks like. Adding a field to it later is additive, and inventing one now would be inventing a typography nobody has asked for.

**Leading, trailing and consecutive breaks are legal.** They are how an author asks for an empty line, and the brief language can produce all three — `::titulo Direito\` ends in one. The IR records what was asked for; whether a frame has room for it is `E4.5`'s question and `W_TEXT_OVERFLOW`'s answer.

**A text node must still have something to draw.** `E_SCENE_EMPTY_TEXT` widens from "no runs" to "no runs that draw anything": a node whose runs are all breaks renders nothing, the same as one with no runs at all, and the invariant that caught the second now catches both.

**Soft and hard breaks are not distinguished.** A distinction only pays if some stage can collapse the soft one, and none can: the three overflow strategies are `clip`, `shrink` and `grow`, all of which change size and none of which reflows by dropping a break. `parseBrief` emits one `Break` for both cases (`docs/brief-language.md`). If a strategy that collapses ever arrives, it arrives with a `soft` field and its own ADR.

## Consequences

Every consumer of `runs` gains a `kind` check. Today that is `invariants.ts`, in two places — the fonts a text declares and the assets its colours pull in, neither of which a break has — and `bounds.ts`, which does not read runs at all. The exporters are still stubs, so E5.1 and E5.2 are written against the union from the start and never against a string scan.

The template SDK gains `lineBreak()` beside `run()`. `text({ runs })` still requires a non-empty list at the type level, which no longer guarantees a drawable node; the invariant is what guarantees it, and that is the correct division — the builders do not validate, `parseScene` does.

`compile` (E4.2) now has a target: a `break` inline becomes a `LineBreak` run. That mapping is E4.2's to write and to test; this ADR only makes it expressible.

The cost of being wrong is one field. If `\n`-in-string had shipped instead, undoing it would have meant changing both exporters after they were written, which is the asymmetry that made this worth deciding before E4.2 rather than during it.
