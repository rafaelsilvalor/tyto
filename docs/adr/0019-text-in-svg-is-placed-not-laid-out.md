# 0019 — Text in SVG is placed, not laid out

Status: accepted · 2026-09-08 · extends ADR 0018 for E5.2

## Context

`export-html` hands a browser a box and a list of runs and the browser decides where the
glyphs go. SVG has no line box, no wrapping and no automatic baseline: every `x` and `y`
in the output is a number the exporter computed. Writing E5.2 meant answering three
questions the HTML path never had to ask, and all three are answered with something less
than the truth, because the truth is a font metric and font measurement is E4.5.

`docs/ir-schema.md` anticipated one of them — the mapping table already says a `break`
"ends the `<tspan>`; the next one starts at `x` with `dy` of one line". It says nothing
about the other two, and the difference matters to whoever compares an SVG with a PNG.

## Decision

**An SVG does not wrap, and that is a stated limit rather than a per-node warning.** A
`box.w` in the IR means "wrap here". Wrapping needs the width of a laid-out string, so
until E4.5 the lines in an SVG are exactly the `LineBreak` runs the brief wrote (ADR 0016)
— a paragraph that wraps in the HTML export runs past the box here.

It is not a diagnostic because a diagnostic is for something its reader can act on. A
template author cannot make E4.5 exist, and a warning on every text node in every export
is a warning nobody reads. It is recorded here, in `docs/ir-schema.md` and in the
package's own doc comment, and it is the first thing E5.3 will see when it diffs the two
rasters.

**A baseline sits `0.8 × size` below the top of its glyphs.** The real number is the
font's ascent. `0.8` is the usual stand-in and it lives as a single named constant in
`packages/export-svg/src/text.ts`, so replacing it with a measured ascent is one edit. The
placement around it is the browser's: half the leading above the glyphs, half below, then
the ascent — which is what keeps the two exports on the same baseline for the single-line
case that is most of a template.

`valign: middle` and `bottom`, and `align: center` and `right`, need the box the text
declared; a text that declared none is drawn from its origin and says so, because there is
nothing to centre in. `align: justify` has no SVG equivalent at all — there is no line box
to stretch — and draws as left.

**`--text-as-paths` takes outlines from a port, and refuses without one.** Converting text
to paths needs glyph outlines and advance widths. `export-svg` is pure (ADR 0010) and owns
no font parser, and E4.5 puts the font machinery in `core`, so the flag reads
`resources.outline` — the same shape ADR 0018 gave bytes. Requested with no resolver, it is
`E_EXPORT_UNSUPPORTED` rather than an SVG that quietly still contains `<text>`, because the
whole point of the flag is a document that depends on no font, and one that silently kept
its text would fail at the print shop instead of in the build.

The port returns an advance as well as a path. Without it a caller could outline each run
and would have nowhere to put the next one; SVG does no layout, and a second run on a line
has to be positioned by hand.

## Consequences

The two exporters agree on shapes and disagree on text, and the disagreement is bounded
and known: same content, same order, same styling, different line breaks wherever a line
would have wrapped. E5.3 compares a raster of each and will see exactly that; the fixtures
in `export-html` and `export-svg` are byte-identical so the comparison is possible at all.

E4.5 closes this. When `core` can measure a laid-out string, the wrapping moves into the
IR — a `TextNode` arrives with the breaks already decided — and both exporters draw the
same lines without either of them learning to measure. That is the reason to put
measurement in `core` rather than in each exporter, and it is why the limit above is
temporary rather than a property of SVG.

Two smaller things follow the same rule of saying what was approximated:
`preserveAspectRatio` has nine alignments and `Image.position` is continuous, so a focal
point off the ninths is snapped and reported; and a mask may only name a node drawn in the
same frame, which is the only thing the template language can express
(`docs/template-authoring.md`) and is reported when it is not.
