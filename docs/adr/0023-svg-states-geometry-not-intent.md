# 0023 — The SVG export states geometry, not intent

Status: accepted · 2026-09-15 · narrows ADR 0019 for E5.5

## Context

TYTO-28 produced an SVG that is correct by the specification and that Chrome renders like
the HTML export — 0 to 1.12% of pixels differ, all of it text placement and stroke
alignment already documented. Opening the same three fixtures in Figma told a different
story: 21.00%, 49.69% and 12.11% of pixels differ from Chrome's render of the same files.

The gap is not that Figma renders SVG badly. It is that three of the constructs the
exporter used are **instructions to a renderer** rather than **shapes**, and an importer
that turns a document into editable layers has to resolve each of them into something its
own model can hold. Figma resolves all three by dropping them:

- `preserveAspectRatio` on an `<image>`, and inside a `<pattern>`, is ignored; the picture
  is stretched to fill its box. That is the whole of `promo.story`'s 49.69% — a `cover`
  photo with its proportions destroyed.
- A nested `<svg>` establishes a viewport, and the viewport's scale is not applied; a 24×24
  mark on a 48×48 node imports at 24×24.
- `<tspan>` elements positioned inside one `<text>` collapse into a single text node,
  because a Figma text layer has one position. `mapping.feed`'s two lines arrived as one
  34px-tall layer named `Turma nova<matrículas & vagas>`, at x=-150.5.

None of the three is a feature Tyto needs and Figma lacks. Each is a fact about the artwork
that the document expressed as a computation for someone else to perform.

## Decision

**Where the IR states a fact about the artwork, the SVG states geometry.** A transform, a
clip path and an element position are the vocabulary every renderer and every importer
agrees on, so the exporter performs the computation and emits its result:

- An image carries its own crop: `<g clip-path="url(#cropN)"><image width height
preserveAspectRatio="none" transform="translate(…) scale(…)"/></g>`, in a node and
  inside a `<pattern>` alike. The `<image>` is given the picture's **own** width and
  height, so `none` is not a contradiction — there is no fitting left to do, and it is what
  makes a renderer that reads the attribute and one that ignores it draw the same thing.
- An inline SVG file becomes `<g transform="translate(…) scale(…)">` around the root's
  children, reproducing `xMidYMid meet` — uniform scale, remainder centred — because that
  is exactly what the viewport it replaces was doing. The root's `xmlns:*` declarations
  move onto the `<g>`, since the element that bound them is the element being dropped.
- A text node draws one `<text>` per line. Every baseline was already an absolute number
  the exporter computed (ADR 0019), so nothing about the picture changes; what changes is
  that a line is a thing an importer can hold.

**The picture's own size arrives through a port, `SvgResources.assetSize`.** A crop is a
scale and an offset computed from the picture's proportions, and nothing in the repository
knew them: `AssetRef` carries an id, a source, a path and a hash. It is a port and not an
IR field for the reason ADR 0018 gives bytes — it is a property of the file, the pure
packages open no files, and the resolver that already read the bytes to make a `data:` URI
has the header in hand. `@tyto/io` answers it from the buffer `readOne` is already holding,
for every format `EMBEDDABLE_MIME` lists.

**An unanswered measurement is not a diagnostic.** The export falls back to
`preserveAspectRatio`, which is what it emitted before this port existed: correct in a
browser, lossy through an importer. A warning would name something no brief author can act
on — only a composition root can wire a port — and ADR 0019 already settled that a warning
nobody can act on is a warning nobody reads.

## Consequences

**A focal point off the ninths is now exact.** ADR 0019 recorded that `Image.position` is
continuous and `preserveAspectRatio` has nine alignments, so anything between them was
snapped and reported. An offset is a number; the snapping and its `W_EXPORT_APPROXIMATED`
remain only on the fallback path. This is the one thing in ADR 0019 that this ADR narrows.

**Chrome fidelity improved rather than being traded away**, which was the card's binding
constraint. Measured on the three fixtures, HTML export against SVG export, same browser,
`pixelmatch` at `threshold: 0.1`:

```
                     before      after
promo.feed            0.16%      0.16%
promo.story           0.00%      0.00%
mapping.feed          4.59%      1.84%
```

The inline-SVG and per-line-text changes are pixel-identical — running the new exporter
with `assetSize` unwired reproduces the "before" column exactly, to the pixel, on all
three. The crop is the only change that moves anything, and it moves toward the HTML: the
`portrait` node's focal point of 0.25 was being snapped to `Mid`, putting the photo 30px
from where `object-position` puts it.

**`W_EXPORT_APPROXIMATED` gains one producer**: an inline SVG file that declares neither a
`viewBox` nor a width and height. There is no box to scale from, the file is drawn at its
own coordinates, and the node's declared size is ignored — which is worth naming, because
the author did declare one.

**Illustrator is unverified.** The measurements above are Chrome's, and the importer
numbers in TYTO-60 are Figma's. Nothing here was opened in Illustrator, and no claim is
made about it.

**Three importer limits are out of scope and stay out**: `<mask>` (the masked image
vanishes), `<filter>` (a drop shadow is dropped) and an embedded `@font-face` (Figma
substitutes its own face, moving text by roughly one font size). Unlike the three above,
these have no geometry to route around — they are features the importer does not implement,
and emitting something else would mean emitting a different picture.
