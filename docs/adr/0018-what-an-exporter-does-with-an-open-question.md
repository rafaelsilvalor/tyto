# 0018 — What an exporter does where the IR left a question open

Status: accepted · 2026-09-08 · fills in `docs/ir-schema.md` for E5

## Context

E5.1 wrote the first real exporter. `docs/ir-schema.md` has a mapping table with eight rows
and the schema has a field for everything, and neither of them settles four questions that
a visitor cannot avoid answering the moment it emits a character. All four bind
`export-svg` (E5.2) and the rasterizer (E5.3) as much as they bind `export-html`, which is
why they are here and not in one package's comments.

Three of them are the IR being more general than an output format. The fourth is the
boundary the pure packages already have and the exporters had not yet had to name.

## Decision

**`clip` on a group does nothing, and says so.** The IR gives a group no size — it is a
transform and a list — so `clip: true` on one has no box to clip to. The literal HTML
reading is worse than nothing: a group's element is a 0×0 box its children overflow, and
`overflow: hidden` on it hides the entire group. The flag is therefore ignored on a group
and honoured on every node that declares a box, with `W_EXPORT_APPROXIMATED` naming the
node so the author can move the flag to the rect or image that defines the box. The
alternative — clipping a group to the union of its children — is a no-op in every case
except a text that overflowed a box it declared, and paying for a bounds pass on every
group to catch that is not worth it.

**A radial gradient's `radius` is a fraction of the node's box, on both axes.** The schema
says `nonNegative` and nothing else, and the centre beside it is a `UnitPoint`, so a radius
in pixels would be the one unnormalised number in the paint. Both exporters read it as an
ellipse scaled to the box: `radial-gradient(ellipse R% R% at …)` in CSS, `objectBoundingBox`
units in SVG. The two then draw the same shape on a box that is not square, which a circle
of `R × width` would not.

**A shadow's `spread` is drawn where the format has one, and reported where it does not.**
CSS `drop-shadow()` has no spread; SVG can build one with `feMorphology`. `export-html`
draws the shadow with spread 0 and emits `W_EXPORT_APPROXIMATED` carrying the number it
dropped. Approximating it — widening the blur by the spread, say — would make the two
exporters disagree by an amount nobody could predict, and silently.

**Bytes reach an exporter through a port, never through a path.** `FontRef` and `AssetRef`
carry a path and a hash, not content, and every exporter package is pure (ADR 0010): none
of them may open a file. Each takes a resolver from its caller and turns an unanswered one
into `E_EXPORT_ASSET_UNRESOLVED` or `E_EXPORT_FONT_UNRESOLVED` rather than emitting the
path. That is what makes the output self-contained, which is what the rasterizer needs —
it opens the document in a browser with no network and no working directory — and what
determinism needs, since a font the viewer happened to have would render text nobody
chose.

## Consequences

Four diagnostic codes join the catalogue: the two unresolved ones above,
`E_EXPORT_UNSUPPORTED` for a scene an exporter cannot express at all, and
`W_EXPORT_APPROXIMATED` for one it can only get close to. All four name the node and the
exporter, because the same scene may be exact in SVG and approximate in HTML, and an
author reading `result.json` needs to know which of the two they are looking at.

`E_EXPORT_UNSUPPORTED` has exactly one producer today: a `text` node used as a mask in
`export-html`. A mask becomes an isolated SVG document inside a `url()`, which cannot see
the page's `@font-face`, so the glyphs would silently vanish. Refusing is the honest
answer until E5.2 has SVG text with embedded fonts; the message names both ways out.

`anchorBox`, `nodeMatrix` and `invertMatrix` become part of `core`'s public surface.
An exporter that nests its output — HTML does — needs each element to carry only its own
transform, and an exporter that draws one node inside another's coordinates needs the
inverse. Both were derivable and both would have been derived twice, which is the same
argument `docs/ir-schema.md` already makes for `SceneVisitor` owning the recursion.

Nothing above changes the IR. If one of these turns out to be wrong, the scene, the brief
and the template are all unaffected; what changes is a visitor and a snapshot.
