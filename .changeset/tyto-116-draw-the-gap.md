---
'@tyto/core': minor
'@tyto/export-html': minor
'@tyto/export-svg': minor
---

TYTO-116 — the three codes ADR 0025 held fatal because skipping them left a hole nothing in
the artwork named are non-fatal, and what makes that safe is that the hole is now drawn
(ADR 0035). `E_MISSING_REQUIRED_SLOT`, `E_EXPORT_ASSET_UNRESOLVED` and
`E_EXPORT_UNSUPPORTED` still fail a build; they no longer cancel the picture.

**One description of the mark, in `packages/core/src/scene/gap.ts`.** Magenta, in two forms
because the two stages that meet a hole draw in different alphabets: `gapStampNode` is IR, an
inside-aligned stroke the size of the frame that `compile` appends to every frame built from
a brief with a required slot unset; `GAP_ASSET_URI` is the same description as a crossed-box
SVG data URI, which both exporters hand back from the one function each already had for _the
bytes of an asset_ — so an `<img src>`, a CSS `background-image` and an SVG `<image href>`
get it with no call site branching.

**It carries no glyph, and that is a constraint rather than a preference.** A `Text` needs a
face declared in the scene and resolved at export, and `E_EXPORT_FONT_UNRESOLVED` is still
fatal — a marker that can fail on a missing font disappears in exactly the runs it exists
for. Which slot is missing is what the diagnostic names.

**The stamp marks the frame and not the slot, which is weaker than the card asked for and is
the decision.** Where a slot would have been drawn is knowledge only the template has, so a
mark in the right place would have to be drawn by the template — and a guarantee a
third-party template can forget is not a guarantee. The exporters, which know a node's box
exactly, do put their mark in place.

**Flipping the field would not have been enough on its own.** Both exporters weighed
diagnostics with `fromDiagnostics`, which reads _severity_, so `fatal: false` on an export
code changed nothing until they called `fromPartial` — the conversion ADR 0025 made for the
earlier stages and skipped here, reasonably, since every export error was fatal then.

**`E_EXPORT_UNSUPPORTED` needed its four producers audited, not just its field changed.** Two
in `export-html` already left the node visible. Two did not: in `export-svg` a mask naming a
node outside the frame left `mask="url(#…)"` pointing at nothing, and now gets a pass-through
`<mask>`; `--text-as-paths` with no outline resolver dropped the words, and now draws them as
`<text>` through the faces the document already embeds.

**Measured.** `resolve` also carries the missing names as value (`missingRequiredSlots`),
because a stage reads its predecessor's value and not its problems. Each new assertion has a
control beside it — a whole brief carries no stamp, a resolved export carries no mark — since
a marker that shows up on healthy artwork would be worse than one that never drew.
