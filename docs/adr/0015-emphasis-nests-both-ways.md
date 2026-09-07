# 0015 — Emphasis nests both ways, and `***` stays out

Status: accepted · 2026-09-07 · amends the inline markup of ADR 0004

## Context

The grammar shipped with emphasis nesting strictly downwards: a mark could hold bold, bold could hold italic, and italic held only text. The reasoning was sound about ambiguity and wrong about where the line falls, which a probe over ten inputs showed:

- `**a *b* c**` already parsed, with the `Italic` node inside the `Bold` — bold holding italic was never the problem.
- `*a **b** c*` failed, purely because `italicInline` omitted `Bold`. There is no ambiguity in it; the rule was asymmetric for no reason an author can perceive.
- `**a *b***` and `***x***` failed for a different reason: longest match reads a trailing `***` as `**` then `*`, so both runs are left open. That is the delimiter-run problem, and an LR tokenizer has no lookahead that could prefer the other split. It is why `@lezer/markdown` is hand-written.

Adding `Bold` to `italicInline` is one line. The generator reported no conflict, and the twenty-two assertions of the fixture corpus stayed green.

## Decision

Emphasis nests in both directions and never inside its own kind: bold may hold italic, italic may hold bold, neither may hold itself. Its own kind is the genuine ambiguity — is the second star of `*a*b*c*` closing the first or opening a nested one — and that stays out.

Two adjacent closers stay out as well. `**bold *italic***` does not parse; the author writes `**bold *italic* **` or reorders so that text separates the closers, and `docs/brief-language.md` says so. Making it parse means replacing the inline layer with a hand-written parser, which would cost the single Lezer tree that `@tyto/brief-lang` exists to guarantee — the compiler and the editor read the same nodes (ADR 0006). If Markdown compatibility ever becomes a requirement, it is a card of its own and an ADR of its own, not a grammar tweak.

## Consequences

Recovery on the `***` case got noisier, and that is the price of the one line. The parser now leaves four identical empty error nodes at the end of the line instead of two, because both open runs get a closer inserted at EOF. `broken-adjacent-emphasis.brief` pins that, so the editor (E8.1) knows to collapse error nodes by offset before drawing a squiggle: four warnings for one typo is worse than the typo.

The AST has to hold the nesting. `Bold` and `Italic` carry `children: Inline[]`, not a string — the sketch in `docs/brief-language.md` said `children` only for `Mark`, which could not have represented `**a *b* c**` even before this change. E3.2 builds that.

The Scene IR needed nothing. A `TextRun` already carries `weight` and `style` independently, so bold-italic text was always representable; what was missing was a way for a brief author to ask for it.
