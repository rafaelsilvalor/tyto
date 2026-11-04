# 0169 — A line never starts with a standalone operator

Status: accepted · 2026-11-04 · TYTO-613 · amends the break rule of ADR 0019 (lines are decided
in the IR), stated in `packages/core/src/text/layout.ts`

## Context

Briefs write math as plain Unicode with spaces around the operators, the brief language the
maintainer approved on 2026-11-04 (ADR 0168): `Q = U · A · ΔT`. Since lines moved into the IR,
a break opportunity has been a plain space and only that, so every operator offered a break on
each side. A render of `voce-conhece` v0.2.0 ended a line on `Q = U` and started the next on
`· ΔT`, which reads as a typo in an exam question.

## Decision

1. **The space before a standalone operator is not a break opportunity.** Layout holds each
   finished word until it sees the next one. When the next word is a standalone operator, the
   two become one word, so the operator stays on the line of the operand before it. The space
   after the operator stays a break. `Q = U · A · ΔT` in a narrow box is laid out as `Q =` /
   `U ·` / `A · ΔT`, never with `·` or `=` first on a line. This is TeX's convention for an
   inline formula: a line may end on a relation or a binary operator, and the next line does
   not start with one.

2. **A standalone operator is a word made only of operator characters**:
   `isStandaloneOperator` in `packages/core/src/text/operators.ts`. Operator characters are
   Unicode's Math Symbol category (`Sm`: `= + < > ± × ÷ − ≠ ≈ ≤ ≥ → ⇒ ∝ ∈`…) plus the three
   characters a brief writes as operators that Unicode files elsewhere: the middle dot `·`
   (U+00B7), the hyphen-minus `-` and the en dash `–`, which plain text uses for a minus. The em
   dash `—` is prose punctuation and is not one. A signed number (`−3`) and an operand with an
   operator inside it (`a+b`) are not standalone operators, and a break before them is
   unchanged.

3. **The rule lives in core's layout, not in the template kit.** Core decides every break of
   every template, and the host lays every frame out again with the same `measureText`. A kit
   rule would be opt-in per template, as `keepTogether` is, and could not reach a template that
   does not call it. The predicate is exported from `@tyto/core` and `@tyto/core/template`, so a
   template or the kit that writes a break of its own can keep the same rule.

4. **A no-break space still wins.** U+00A0 is not a break anywhere, so an author who wants a
   whole formula on one line still writes `Q U+00A0 = U+00A0 U …` (`keepTogether` and
   `docs/template-conventions.md`).

## Consequences

- A formula wider than its box still breaks, after an operator: `a + b + c + d` in a box two
  operands wide is `a +` / `b +` / `c +` / `d`.
- Prose that uses a spaced hyphen or en dash as a dash (`Rio - SP`, `2024 – 2026`) keeps the
  dash at the end of the line before. That is also how Portuguese typesets a spaced dash.
- `export-html` sets `white-space: pre-wrap`, so a browser could still break before an operator
  inside a line the IR already found wider than its box: one operand and its operator that do
  not fit even alone. That is overflow either way and was already reported as such.
- The kit's `rebreak` (TYTO-520) inserts a break of its own before the last word of a line, and
  can still choose an operator. It is aligned with this rule in a follow-up, through the
  exported predicate.

## Rejected

- **Keep the operator with the operand after it** (`Q = U` / `· A · ΔT`). The card offered this
  reading, but it starts a line with the operator, which is the defect that was seen. Either
  reading stops the operator from standing alone at a line edge, and only this one keeps it off
  the start of a line.
- **No break on either side of an operator.** The whole formula becomes one word, so a formula
  wider than its box could not break anywhere and would overflow.
- **A rule in the template kit.** Opt-in per template, and invisible to a template that does not
  call it.
