# 0156 — export-html draws a spread through an inline SVG filter

Status: accepted · 2026-10-30 · TYTO-483 · amends ADR 0018 (a shadow's `spread`)

## Context

ADR 0018 says a shadow's `spread` is drawn where the format has one and reported where it
does not, and filed HTML under "does not": CSS `drop-shadow()` has no spread, so
`export-html` drew the shadow at spread 0 and emitted `W_EXPORT_APPROXIMATED`. The raster
is `export-html` in Chromium, so the PNG lost the spread too. On 2026-10-30 a template in
its own repository (TYTO-477, questao-estrategica) needed a PSD shadow with a spread and
faked it with a hidden, smaller shadow caster.

HTML does have a way to draw one, and two were on the table:

- **`box-shadow`**, which takes a spread. It follows the element's border box, not what the
  element paints, so it is wrong for a path, a glyph, an image with alpha and a group — a
  group's element here is a 0×0 box. It is also drawn only outside the box, so a shadow
  under a translucent fill would not show through it. Each of those would make the HTML
  and the SVG export two different pictures.
- **An SVG `<filter>` the CSS filter list names with `url(#…)`.** A CSS filter list may mix
  functions and references, each taking the previous one's result, which is exactly how
  `export-svg` chains its primitives.

## Decision

**`export-html` draws a shadow with a spread through the filter `export-svg` draws it
with.** The document carries an inline `<svg class="tyto-filters">` before the frame, out of
its flow, holding one `<filter>` per such shadow: `feColorMatrix` to alpha, `feMorphology`
(`dilate` for a positive spread, `erode` for a negative one), `feOffset`, `feGaussianBlur` at
half the blur radius, `feFlood`, `feComposite`, `feMerge` — the primitives and numbers of
`spreadShadow` in `packages/export-svg/src/defs.ts`. The CSS filter list names it where
`drop-shadow()` would have been, so the IR's effect order is kept. A shadow with no spread
keeps `drop-shadow()`, which draws it exactly.

**The filter region is the frame, in the node's own coordinates, in user space.** The
default region is a margin around the element's box, and a group's box is empty; its
shadow would vanish with everything the group draws. The frame mapped back through the
node's transform is everything of the node that can show, padded by the shadow's offset,
spread and twice its blur so a node just outside the frame still casts into it.

The warning goes: no format Tyto exports drops a spread any more.

## Consequences

Measured on the raster fixture `spread.json` (a rounded rect, a path, a group and a negative
spread under a translucent fill): the HTML render and the SVG export rendered by the same
Chromium differ in 0 of 40 000 pixels, and the suite keeps that comparison. A scene with no
spread produces the same bytes as before.

The SVG primitive chain now lives in two packages, deliberately: an exporter does not
import another exporter, and the cross-render test is what fails when the two drift.

A template that faked a spread with a hidden caster can drop it.
