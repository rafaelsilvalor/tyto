# 0229 — A mark after a typed break starts a piece at its level

Status: accepted · 2026-11-24, by the maintainer · TYTO-854 · amends TYTO-822's reading of a
typed break (`docs/slot-vocabulary.md`, "Levels inside a block")

## Context

A block's line is cut into parts by `|`, and a `#` to `######` before a part sets its level.
TYTO-822 decided that a `\` the author types breaks the line **inside** its part and never
starts a new one: `Concurso | # ABIN \ 2027` is one main part on two lines, both at the main
level.

On 2026-11-24 the maintainer asked for each piece between typed breaks to carry its own level:
`não afetado \ # afetado`, a lead-in on one line and the name, larger, on the next. With `|`
the two would already be two levels, but separated by the part gap, not by the line height of
one text.

Two readings were possible for the text after a `\` with no mark: it falls to the base level,
or it keeps the level of the piece before it. The first changes every brief that writes a `\`
inside a name today (19 of 172 test briefs write a `\`; none writes `\ #`). The maintainer
chose the second on 2026-11-24.

## Decision

1. **Inside one `|` part, a typed break followed by a mark (`#` to `######` and a space) starts
   a new piece at that level.** `levelsOf` returns it as one more `LevelPart` of the line,
   marked `joined: true`. Seven `#`, or a mark glued to its word, are words, as everywhere.
2. **Text after a typed break with no mark stays in the piece before it, at its level.**
   `# Concurso ABIN \ 2027` is unchanged. To drop to the base level, the author writes `|`.
3. **The line's main piece is the first at the highest level written**, the rule parts already
   follow, so `mainLineScale` grows that piece alone to the width.
4. **`levelStack` draws a joined piece as the next line of one text**: no part gap above it.
   Every other reader (a card's segments, a template's own) sees a joined piece as a part, in
   its place; a template that treats the parts before the name in a special way (anuncio's
   faixa strip) decides for itself whether a joined piece belongs there.

## Consequences

- A brief without `\ #` reads exactly as before: the kit's snapshots and every typed-break test
  of TYTO-822 are unchanged.
- `\ #` was words before (the `#` drawn as a character); no test brief writes it.
- Templates pick this up with the kit's next release; anuncio adopts it in TYTO-855, with the
  faixa strip taking only the `|` parts.
