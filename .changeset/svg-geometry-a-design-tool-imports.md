---
'@tyto/export-svg': minor
'@tyto/io': minor
---

TYTO-60 — export-svg emits geometry a design tool actually imports

The SVG export was spec-correct and Chrome rendered it like the HTML export, but Figma's
importer dropped three of the constructs it used — 21.00%, 49.69% and 12.11% of pixels
differed from Chrome on the three fixtures. All three were instructions to a renderer where
a shape would have done, so all three are now shapes (ADR 0023).

What changes in the output:

- **An image carries its own crop.** `<g clip-path><image transform="translate(…) scale(…)"
preserveAspectRatio="none"></g>` instead of a `preserveAspectRatio` that Figma ignores on
  an `<image>` and inside a `<pattern>` alike, stretching every `cover` photo to fill. A
  focal point is exact as a result, where it used to be snapped to one of nine alignments
  and reported.
- **An inline SVG file is a scaled `<g>`, not a nested `<svg>`.** The viewport a nested
  `<svg>` establishes is not scaled on import, so a 24×24 mark on a 48×48 node arrived at
  24×24. The file is still handed over verbatim; the root's `xmlns:*` declarations move onto
  the `<g>` with its children.
- **One `<text>` per line.** Positioned `<tspan>`s inside a single `<text>` collapse into one
  Figma layer, because a text layer there has one position. Every baseline was already an
  absolute number the exporter computed, so the picture is unchanged.

`SvgResources.assetSize` is new and is where the crop's arithmetic gets the picture's own
width and height — a port for the reason ADR 0018 gives bytes. `@tyto/io` answers it from
the buffer it is already holding, reading the header of any PNG, JPEG, GIF, WebP, AVIF or
SVG it embeds. Wired up by `fileResources` and `fileTemplateAssets`; a caller that supplies
no `assetSize` gets the previous output, `preserveAspectRatio` and all, with no diagnostic —
only a composition root can wire a port, so there is nobody to warn.

Chrome fidelity was measured before and after, HTML export against SVG export, and improved
rather than being traded: `promo.feed` 0.16% → 0.16%, `promo.story` 0.00% → 0.00%,
`mapping.feed` 4.59% → 1.84%. Illustrator remains unverified.
