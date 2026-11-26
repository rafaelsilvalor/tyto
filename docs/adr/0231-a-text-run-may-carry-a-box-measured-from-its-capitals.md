# 0231 — A text run may carry a box measured from its capitals

Status: accepted · 2026-11-26 · TYTO-900 · builds on ADR 0016, ADR 0019, ADR 0206 and ADR 0230

## Context

Some art sets a word white on a filled box inside an ordinary paragraph. The
concursos-abertos-ec sign-off (`src/template.ts:332` at 5cd97b1) does it by breaking the lines
itself: a greedy loop over the words, the boxed word one unit, a `rect` and its own `text` per
boxed word. The box reaches 16 px above the capitals and 15 px below the baseline, with 17 px
each side (`SIGN_OFF.box`), and is as tall as `over + cap height + under`.

A template cannot do this with the IR it has. A `TextSpan` carries no background. The lines
are broken by core's layout (ADR 0019) and drawn by the exporter, so only those stages know
where a word lands. ADR 0230 asks for every drawn element to come from a primitive or a
component. A box that a template positions by hand, next to text that something else breaks,
is the opposite of that. AGENTS.md: "If something must appear in the output, it enters the
IR first."

Measured before deciding (TYTO-900, system Chrome 158.0.8127.37 and Electron 44.4.5's
Chromium 152.0.7977.130):

- **CSS cannot place this box on every Chromium we ship.** `text-box: trim-both cap
alphabetic` on an inline span trims it to the capitals in Chrome 158: Arial 100 px came
  out 71.63 tall, its cap height. Electron 44's Chromium 152 ignores the declaration on an
  inline box. The same file drew a box 110.2 px tall there, against 70.59 in Chrome. The
  desktop app previews and exports PNGs in Electron's Chromium
  (`apps/desktop/src/main/rasterizer.ts`).
- **The browser builds an inline box from the face's hhea ascent and descent, each rounded
  to a whole pixel.** Source Sans 3 at 60 px is 60 above the baseline and 20 below, in both
  browsers. Core's `Face` reads 1 and 0.326 em, which is 60 and 19.56.

## Decision

1. **A `TextSpan` may carry a `box`**:
   `{ paint, padding: { x, over, under }, radius?, metrics? }`. All lengths are px.
   - `over` is measured from the cap height and `under` from the baseline. This is ec's
     model, and the way a designer measures a box around capitals.
   - `x` is added on each side, and takes room in the line as inline padding does.
   - `radius` rounds the box; absent is square.
   - `paint` is solid only. A gradient or an image in a box is a later ADR.
   - There is no line-box mode. If one is needed, a later ADR adds an `edge` field next to
     `padding`, with `'cap'` as today's meaning.
2. **The box's face metrics travel in the Scene.** `metrics` holds `{ ascent, descent,
capHeight }` in em: hhea ascent and descent, and OS/2 cap height. `compile`'s text layout
   writes them from core's `Face` (`withBoxMetrics`, `text/box-metrics.ts`), because it is
   the stage that holds the faces. A template never writes them.
   - The exporter is handed a URI per face and cannot read a font. Giving it a font port
     would move font reading into the exporters. Putting the numbers in the Scene keeps
     every exporter a pure function of the Scene, as ADR 0206 did for formula layout.
   - `Face` gains `capHeight`.
3. **Core's line breaking counts the box.** A boxed run adds `x` wherever it starts on a line
   and wherever it ends. A line the word may end on is measured with the box closed. So
   core breaks the lines where Chromium would, and the exporter never wraps them again.
4. **export-html paints the box as a band inside a span of its own around the run's span.**
   - The band is an SVG rect, so `radius` rounds the band and not the span's taller box.
   - It is placed from the metrics: it starts `round(ascent × size) − capHeight × size −
over` below the top of the span's glyph box, and is `over + capHeight × size + under`
     tall.
   - Padding grows the span only where the band reaches past the glyph box, since padding
     cannot be negative.
   - `box-decoration-break: clone` gives every line the run breaks across a band, padding
     and radius of its own.
   - One mechanism draws in both browsers: no `text-box`.
5. **One box per line fragment.** A run broken across two lines draws two boxes, each the
   same height, each with both paddings.
6. **Without metrics, the box is drawn over the run's glyph box and the export says so.**
   This covers a face that could not be read, or one without a cap height. The band is the
   whole padded span: the font's ascent plus descent, plus `over` and `under`. export-html
   reports `W_EXPORT_APPROXIMATED`.
7. **export-svg draws the text without its box, and reports `W_EXPORT_APPROXIMATED` once
   per boxed run.** SVG does not wrap and measures no glyph widths (`text.ts`), so it does
   not know where the run lands. A follow-up gives it the line fragments once text is
   measured for SVG.
8. **Runs merge only when their boxes match.** `runsOf` already merges neighbours that would
   draw the same thing. Two neighbours with the same box are one box; different boxes stay
   two runs. `RunStyle`, and therefore the kit's `HighlightStyle`, can name a box, so a
   highlight or a mark can box the words it wraps.

## Consequences

- Without changing the stack, a template boxes a word by marking it. The exporter breaks
  the lines; the template no longer breaks them by hand. concursos-abertos-ec's recomposition
  (TYTO-893) can drop its own greedy loop.
- Measured on the boxed fixture (`packages/raster/src/__fixtures__/boxed.json`):
  - Electron 44 and Chrome 158 draw the same bands: in each capture, the box's pixel rows
    and columns match.
  - The band sits 16–17 px over the capitals' ink and 15 px under the baseline.
  - A perturbation of `over`, of the cap height, of `clone` or of core's side padding turns
    the tests red.
- **The first fragment of a broken run keeps the space it broke at inside its box.**
  Measured: 30 px of right inset against 18 at 60 px bold. Chromium keeps the collapsed
  space in the inline fragment. A boxed single word, which is ec's case, never meets it.
- The band trusts that Chromium rounds the ascent to a whole pixel. That is measured at
  60 px in two Chromium versions, not proven for every size. A size where the rounding
  differs moves the band by under half a pixel.
- A formula run carries no box: `FormulaRun` has no such field, and a boxed mark around a
  formula boxes only the text around it.
- When a node shrinks (`overflow: 'shrink'`), the box's padding stays in px while the text
  scales.
- `highlightsFromValues` cannot read a box from declared values yet. A template names one in
  code. Reading it from values is a follow-up.
