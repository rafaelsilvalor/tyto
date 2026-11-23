# 0228 — A brand kit may carry a background pattern

Status: accepted · 2026-11-22, by the maintainer · TYTO-842 · amends ADR 0063 (a plugin
contributes a brand kit) as amended by ADR 0066 and ADR 0155

## Context

A kit is `{ logo?, wordmark?, signature?, colors? }`. The reference art for the remarketing ad
(TYTO-803) has one more thing that belongs to the house rather than to the ad: a faint lattice
inside its panel. In the reference's source file it is a layer of its own: diagonals, a dot at
every crossing and a fine grid under them, drawn at about 8% and cut to the panel.

That lattice had two possible homes: the ad's template, which is a public repository, or the
kit, which a private plugin supplies. On 2026-11-22 the maintainer chose the kit. That keeps the
house's art direction out of the public repository, lets every template use the same
background, and lets each brand have its own.

## Decision

### A kit may carry a pattern

`BrandKit.pattern?` is `{ tile: { w, h }, layers }`. Each layer is either:

- filled: `{ tone, d, fillRule }`, like a toned mark's layer;
- stroked: `{ tone, d, stroke }`, where `stroke` is the line's width in the tile box's units.

A lattice is lines, and a line is a stroke. Holding a line as a thin filled outline would make
the kit's author draw what every exporter already draws.

**Geometry in, colour out** (`docs/template-conventions.md`, ADR 0066). A layer carries a tone,
never a colour, and the pattern carries no opacity. The template that lays the pattern picks
each tone's ink and how faint the whole is, so the same lattice can follow the colour a brief
gives the panel.

### The bounds

These are the bounds of a toned mark (ADR 0066), for the same reason: the kit rides every call
an installed code template answers.

- 1 to 16 layers.
- `MARK_PATH_LIMIT` bounds the sum of the layers' paths.
- A stroke must be positive and no wider than the tile's shorter side.
- Any other key is refused at activation, a colour or an opacity included.

### How a template lays it

`drawPattern(kit, { size, tileWidth, inks, opacity, mask? })` in `@tyto/house-style` does the
laying:

- It lays tiles edge to edge from the area's top-left corner, each tile drawn `tileWidth` wide.
- Each tile is a group of one vector per layer, scaled as `drawBrandMark` scales a toned mark.
- The opacity goes on the whole pattern once. Where a line runs past its tile into the
  neighbour, the neighbour draws the same line in the same ink, so nothing darkens.

**The template cuts the pattern with a mask**: a node of the same frame named by its id, which
is usually the panel itself. `drawPattern` puts the mask on every vector, not on the group:

- A group has no box in the IR, so `clip` on a group means nothing (`export-html`'s
  `clipDeclarations`).
- A masked group draws nothing in `export-html`. Its element is a 0×0 box, and CSS paints a
  mask only inside the element's box. This was measured on 2026-11-22 in the system Chrome:
  a lattice under a panel mask came out as a blank panel. `mask-clip: no-clip` made it visible,
  but then nothing was cut: a pixel outside the panel's rounded corner stayed blue.
- With the mask on each vector, whose box is its size, the same probe was cut at the corner
  and kept the lattice inside it.

Without a mask, the last row and column of tiles run past the area by up to one tile.

**No placeholder.** `drawPattern` returns `undefined` for a kit without a pattern. A stand-in
would change every render without a kit, which ADR 0065 fixed. No layout needs a pattern's room
held, as with the wordmark (ADR 0066).

### The protocol is 32

`brandKitSchema` is strict and sits both in the `brand-kit` registration and in
`templateCallSchema`. A host or guest on 31 would refuse a kit with a pattern, so
`RPC_PROTOCOL_VERSION` is 32, and the handshake refuses a stale pair first.

## Consequences

- A private kit can give a brand its lattice. TYTO-843 does it for the brand the remarketing ad
  uses, and TYTO-844 draws it in the ad's panel.
- `@tyto/core` exports `BrandPattern`, `PatternLayer` and `brandPatternSchema`. Below 1.0 that
  is a minor bump (ADR 0040), as is the protocol number for `@tyto/plugin-api`.
- A kit with a pattern needs a Tyto on protocol 32. A private kit raises its `engine` by hand.
- Every template that does not call `drawPattern` draws exactly what it drew before.
- Not decided:
  - a third tone. The lattice's fine grid is a third colour in the reference, and the kit
    either draws it in one of the two tones or leaves it out;
  - an offset or a rotation for the tiles, which waits for art that needs one.
