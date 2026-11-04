# 0168 — A glyph its face lacks is drawn in the symbol face

Status: accepted · 2026-11-04 · TYTO-484 · extends ADR 0019 (lines are decided in the IR), ADR
0021 (Tyto bundles its faces) and ADR 0048 (a code template's faces cross with the call)

## Context

Exam questions for the engineering vertical write math as plain Unicode characters: `Δv = a·Δt`,
`∇·E = ρ/ε₀`, `ℏ ≈ 1,05 × 10⁻³⁴ J·s`. The house face CircularXX drew 54 of the 134 symbols the
`questao-estrategica` session measured on 2026-10-30. A browser draws a glyph its face lacks in
whichever face it finds next on the machine. Measurement asked only the run's own face, which
answers a missing glyph with its `.notdef` advance, so the width that decided where a line breaks
was not the width drawn, and the answer options overlapped.

Measured for this card on 137 symbols (Greek, operators, arrows, sets, integrals, super- and
subscripts): Noto Sans Math 3.000 draws 101, Source Sans 3 draws 114, and the two together draw 136. Only `℃` is in neither.

## Decision

1. **`@tyto/fonts` bundles Noto Sans Math 400** (OFL 1.1), the unhinted `.ttf` from the
   `NotoSansMath-v3.000` release and a `.woff2` compressed from that same file, because the
   release ships none. Its `LICENSE.md` records the archive, the two files' SHA-256 and how the
   `.woff2` was made. It is listed after Source Sans 3, because `system.ts` substitutes a missing
   machine face with the first bundled family, and a symbol face cannot stand in for a text face.

2. **The choice is made glyph by glyph in `measureText`, and it enters the IR.** Before a node
   is laid out, each text run is split where its own face stops drawing (`Face.has`, read from
   the face's `cmap`). A character the face lacks goes to the first face of the chain that has
   it, as a span naming that face (`source: 'bundled'`). The split runs are what `measureText`
   returns and what `compile` writes into the node. Both exporters draw spans as they always
   have, so what was measured is what is drawn, and no exporter changed. This is the hard rule
   that whatever must appear in the output enters the IR first.

3. **The chain is `[Noto Sans Math 400 normal, Source Sans 3 at the run's style and nearest
shipped weight]`.** Noto Sans Math is first because it is the face designed for math:
   operators, arrows, sets, `∇`, `ℏ`, `√`. Source Sans 3 is second because Noto Sans Math leaves
   the super- and subscript digits (`²`, `₀`, `⁻³⁴`), `·`, `°` and `‰` to text faces, and Source
   Sans 3 is the text face Tyto already bundles. A combining mark stays in the face of the glyph
   it sits on.

4. **A face is in the chain only if the face cache answers it.** On the host it always does.
   In a code template's plugin process only the faces its manifest lists under `faces:` cross
   (ADR 0048). **A template that wants its own measure to agree with the host lists both chain
   faces under `faces:`**: `{ family: Noto Sans Math, weight: 400 }` and Source Sans 3 at the
   weights it uses. A template that lists neither still renders correctly, because the host lays
   every frame out again. Only the boxes the template sized from its own measure can disagree.
   The chain itself is exported as `fallbackChain` from `@tyto/core/template` (TYTO-619), so a
   template's faces test derives those faces from the rule layout uses instead of a copy of it.

5. **A word is placed whole across runs.** Splitting turns `Δv` into two spans, and layout used
   to treat a run boundary as a place a line could break. A word is now the pieces up to the next
   space, whatever runs they come from, which is also what a browser does with `**Δ**v`.

6. **`W_GLYPH_MISSING` names a character no face draws**, at the slot's range, in the format it
   was laid out for. It is raised by `compile` on the host only, and that is enough: the host lays
   out every frame again, a code template's included, with every bundled face. The host's layout
   is the one drawn, so it is the one place that sees the whole chain. The guest's `measure`
   returns the same `missing` list for a template to read, but nothing crosses the report
   boundary, so ADR 0058's closed list and `RPC_PROTOCOL_VERSION` are unchanged.

## Consequences

- A brand face draws what it has and the symbol face draws the rest, per glyph, which is the
  brief language the maintainer approved on 2026-11-04. Fractions and roots with a bar stay
  pictures.
- Noto Sans Math has one weight. A symbol inside a bold run is drawn at 400, and only Source Sans
  3's glyphs follow the run's weight.
- The subscript letters (`ₐ ₑ ₒ ₓ ₕ ₖ ₗ ₘ ₙ ₚ ₛ ₜ`) and `℃` are in neither face. They are
  reported by `W_GLYPH_MISSING` and drawn in whatever face the machine finds.
- `packages/raster/src/symbol-metrics.visual.test.ts` measures each sample line against
  Chromium's laid-out width and keeps a control arm without the chain.
- Each install pays about 0.9 MB for the face (657,440 bytes of `.ttf`, 245,844 of `.woff2`).
  An HTML document embeds the `.woff2` only when a run is drawn in it.

## Rejected

- **A CSS `font-family` stack in the exporters.** The browser would pick the face, but the SVG
  exporter and measurement would each need to repeat its choice, so three places would decide
  the same thing. The IR would also not say which face draws a glyph.
- **STIX Two Math first.** It is a serif design, and the house faces are sans.
