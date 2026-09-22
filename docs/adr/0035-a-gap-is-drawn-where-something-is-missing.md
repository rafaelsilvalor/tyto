# 0035 — A gap is drawn where something is missing

Status: accepted · 2026-09-22 · TYTO-116 · answers the open question in ADR 0025

## Context

ADR 0025 separated severity from fatality and left one thing undecided, in its own words:

> a missing required slot must draw as something, and what that something is — a
> placeholder node in the IR, a marker the exporter adds — is an open question this ADR
> does not answer. Until it has an answer, `E_MISSING_REQUIRED_SLOT` stays fatal, whatever
> the table above says.

Three codes were held fatal by that sentence, for a reason the generated
`docs/diagnostic-codes.md` calls "a deadline rather than a principle":

| Code                        | What the hole looks like                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `E_MISSING_REQUIRED_SLOT`   | The manifest promised content and the brief left it unset. The artwork renders complete, minus the headline. |
| `E_EXPORT_ASSET_UNRESOLVED` | The bytes for an image the scene draws were never loaded. A blank rectangle where a logo goes.               |
| `E_EXPORT_UNSUPPORTED`      | The exporter cannot express a node and leaves it out. Whatever that node was drawing is absent.              |

The argument against making them non-fatal was never about severity. **A partial render can
mislead in a way a stale one cannot**: it shows art that looks finished with a slot silently
empty, and somebody in a hurry exports it. "This is the last version that worked" is never a
lie; "here is your art, minus the broken part" can be.

## Decision

**The gap is drawn, by whichever stage met it, from one description held in `core`.**

`packages/core/src/scene/gap.ts` is the whole of what the mark is. Nothing else in the
repository decides its colour, its shape or its width, because two descriptions are two
chances to draw a marker somebody mistakes for design.

### The colour is magenta and carries no text

`GAP_COLOR` is `rgb(255, 0, 170)`, a colour no template in this repository uses. A marker in
a plausible brand colour reads as a design decision; this one is also what print and layout
tools have meant by _missing_ for decades.

**No glyph anywhere in it, and that is a constraint rather than a preference.** A `Text` node
needs a face declared in the scene and resolved to bytes at export, and
`E_EXPORT_FONT_UNRESOLVED` is still fatal — a marker that can fail on a missing font is a
marker that disappears in exactly the runs it exists for. Which slot is missing is what the
diagnostic names; the mark says only _this is not finished_.

### Two forms, because the two stages that meet a hole draw in different alphabets

- **`gapStampNode(id, size)`** is IR: a `Rect` the size of the frame, no fill, an
  inside-aligned magenta stroke. `compile` appends it to every frame it builds from a brief
  that left a required slot unset. Inside-aligned so the band cannot push the artwork out of
  the frame, and last in `children` so it sits over what the template drew. Its width is
  `max(4, round(min(w, h) / 60))` — 18 px on a 1080 frame, 36 on a 2160 export — because a
  constant is a hairline at one size and a wall at another.
- **`GAP_ASSET_URI`** is that description as a `data:image/svg+xml` document: a crossed box
  that stretches to whatever box it is given. Both exporters answer with it from the one
  function each of them already had for _the bytes of an asset_, so an `<img src>`, a CSS
  `background-image` and an SVG `<image href>` all get the mark without a call site learning
  anything new.

### The stamp marks the frame and not the slot, deliberately

Where a slot would have been drawn is knowledge only the template has: `compile` hands it a
`slots` record and gets a finished `Frame` back. A mark in the right place would therefore
have to be drawn by the template — and **a guarantee a third-party template can forget is
not a guarantee**. What the stamp can say honestly is _this artwork is incomplete_, on every
frame, in the exported bytes.

This is weaker than TYTO-116's own wording, which asks that "the artwork shows where the
missing content goes". It is the strongest thing that holds for a template nobody in this
repository wrote. Position is available to the exporters, which know a node's box exactly,
and that is why the asset case gets the crossed box in place and the slot case does not.

### `resolve` carries the names as value, not only as a diagnostic

`ResolvedBrief.missingRequiredSlots` is the same list `E_MISSING_REQUIRED_SLOT` reports. A
stage reads its predecessor's value; one that had to sift its predecessor's problems to know
what to draw would be reading the wrong channel.

### The exporters weigh diagnostics by fatality now

`exportHtml` and `exportSvg` called `fromDiagnostics`, which fails on any **error**. Flipping
`fatal` on the two export codes would have changed nothing while that was true, because it is
`hasErrors` and not `hasFatal` that was deciding. Both now call `fromPartial`, which is the
move ADR 0025 made for the earlier stages and did not make here — reasonably, since every
export error was fatal at the time.

`E_EXPORT_FONT_UNRESOLVED` is unaffected and stays fatal: text drawn in whatever face the
viewer happens to have is a different artwork, and nothing in the output says so.

### Every producer of `E_EXPORT_UNSUPPORTED` now leaves the node visible

The code is one name over four situations, and making it non-fatal is only safe if none of
them hides anything. Counted and handled one at a time:

| Producer                                            | Before                                                 | Now                                            |
| --------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| `export-html`, mask naming a node nothing defines   | mask left off, node drawn                              | unchanged                                      |
| `export-html`, a text node inside a mask            | mask document empty → declaration dropped → node drawn | unchanged                                      |
| `export-svg`, mask naming a node outside this frame | `<mask>` never emitted, `mask="url(#…)"` left dangling | a pass-through mask, so the reference resolves |
| `export-svg`, `--text-as-paths` with no outlines    | `?? ''` — the words vanished                           | drawn as `<text>`, through the embedded faces  |

The two `export-html` rows were already safe; the audit is recorded because "already safe"
is a claim that needed checking rather than assuming, and because the second one reads like
a hole and is not.

The `export-svg` mask row is the one with a choice. The `mask` attribute is written during
the walk, before the frame knows whether the target is in it, so leaving the `<mask>` out
points the reference at nothing and lets each renderer decide what that means. A mask that
hides nothing says _this mask does nothing_ in a vocabulary every renderer reads the same
way, and it is what `export-html` already achieves by dropping the declaration.

## Consequences

**A template that draws a required slot unguarded now fails differently.** It used to be
stopped at `resolve` with `E_MISSING_REQUIRED_SLOT`; now it builds a `Text` node with no
runs and meets `E_SCENE_EMPTY_TEXT`, which is fatal and correct — the IR is malformed. The
guard is one line and both built-in routes already have it: `agenda-semana` returns no cover
block when `titulo` is absent, and the markup route draws no node for an unset slot.

**`result.json`'s third state now covers three more codes.** "Rendered, with errors" is
`status: error` with a non-empty `artifacts`, which `docs/render-contract.md` already
describes; what changes is how often it is the answer.

**The mark is in the raster too**, because it is ordinary IR and an ordinary data URI, and
the rasterizer opens the same HTML. Nothing in `packages/raster` knew about this decision and
nothing had to.

**What this does not do** is tell a reader which slot is empty from the picture alone. That
needs text, which needs a face, which is the constraint above. A bundled marker face would
lift it and would be a card of its own; the diagnostic is what carries the name until then.
