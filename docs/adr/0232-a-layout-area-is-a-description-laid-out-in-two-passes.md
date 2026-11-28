# 0232 — A layout area is a description laid out in two passes

Status: accepted · 2026-11-28 · TYTO-912 · builds on ADR 0224, ADR 0225 and ADR 0230; frames
TYTO-913, TYTO-914 and TYTO-915

## Context

Every kit piece follows ADR 0224's contract: it takes an area (`{ width, height }`) and declared
parameters and returns a measured `Block` with its `overflow`. The arrangements that put pieces
together each cover a part of layout: `stackIn` stacks, `rowIn` lines up, `insetIn` pads,
`blockColumn` orders and shrinks, `fittedColumn` searches a size, `spaceByWeight` spreads room by
weight. All of them receive their children **already built**, so a child is measured before its
parent knows how much room it gets. Read in the code at `origin/main` acebbd62 (kit 0.27.1),
seven things are missing: measure-then-place across nested levels; a per-child size mode (fixed,
by content, or a share of the room left); the direction as a parameter; padding on the
arrangement itself; distribution along the flow; children outside the flow; and an arrangement
that disappears when it has nothing to show.

The maintainer asked on 2026-11-28 for "a function that defines the template's areas: it groups
elements, defines gaps, order and flow; areas inside areas; an area either fills the space or has
a fixed size; thinking ahead to the node system", before TYTO-897 and TYTO-896 are recomposed.

## Decision

1. **An area is a description first.** `area({ … })` returns plain data — `{ kind: 'area', name,
parameters, order, children }` — and draws nothing. `areaIn(room, description)` lays it out
   and returns `Block & { overflow }`, the contract of ADR 0224 decision 1. A child is a nested
   area, a leaf `(room) => Block | undefined` (any kit piece that takes an area, wrapped
   unchanged), a ready `Block`, nothing, or a slot `{ item, name?, width?, height?, min?, max?,
gapAbove?, float? }` around one of those; today's `StackItem` is such a slot. This is the
   shape of a node: parameters a panel reads, and inputs wired to other nodes.

2. **Two passes, each child built once.** In the area's flow (`column` or `row`):
   - children sized by a number or by their content are built first, a hugging one with an
     unbounded room along the flow and the cross room known;
   - the room left — the area's inner size less those children and the gaps — is split among the
     children that fill, by weight, each held by its `min` and `max`; a share a bound holds is
     frozen and the rest is split again among the others;
   - each fill child is then built with its share, and every child is placed by the gaps,
     `justify` along the flow and `align` across it. A nested area repeats this inside the room
     it was given.

   A hugging child that its `min` or `max` holds is built a second time at the size it was held
   to; a ready block keeps its size and sits at the start of its room. In `measureFrom:
'capitals'` the room left is measured with each fill child at 0 and read by its box, so it is
   exact when a filling child has no words, which is what fills.

3. **Size modes and their two rules.** A size is a number, `'hug'`, `'fill'`, `{ fill: weight }`
   or `'auto'`. Two rules settle what the modes mean where they would otherwise be undefined:
   - **A fill with no definite room to share is measured by its content.** An area's size along
     an axis is definite when it is fixed, or when it fills a bounded room. In an area that hugs,
     or in an unbounded room, `'fill'` acts as `'hug'`.
   - **`align: 'stretch'` makes an unset cross size fill.** A child whose size across the flow
     is `'auto'` (unset) fills the area's cross room when the area stretches; elsewhere `'auto'`
     is `'hug'`. A child with a stated cross size keeps it.

4. **The area's own size is in its schema.** `AREA_PARAMETERS` (ADR 0224 decision 2) declares
   `flow`, `gap`, `measureFrom`, `justify`, `align`, the four paddings, `widthMode` (`auto`,
   `hug`, `fill`, `fixed`), `width`, `widthWeight`, the same three for the height,
   `minWidth`/`maxWidth`/`minHeight`/`maxHeight` (a minimum of 0 is no floor), and `collapse`.
   The ergonomic options (`width: { fill: 2 }`, `padding: [t, r, b, l]`) become these values in
   `area`. A child's size in its parent is its slot's, or a child area's own parameters.

5. **Floating children, and the draw order.** A slot with `float: { anchor, x, y }` is out of the
   flow: built in the area's outer box once the area knows its size, held to one of nine points
   (four corners, four edge midpoints, the centre) and moved by the offset. It takes no room and
   no gap. **The draft is a group of the flow's children in order, then the floats in source
   order**; a box the area draws (TYTO-913) goes before both, under them.

6. **Collapse when empty.** A child that is `undefined`, `null`, `false`, a slot with no item, or a
   leaf that answers `undefined` is absent: no room and no gap. An area left with no child in its
   flow is absent to its parent (its floats go with it) while `collapse` is `'when-empty'`, the
   default; with `'never'` it keeps its padding and size. At the top, `areaIn` answers an empty
   block for an area that collapses.

7. **Order is `columnOrder`, once.** `order: context.order` (ADR 0225) puts the children the brief
   names in the brief's order and leaves the others in their source places, by the child's slot
   name or a child area's own name. It calls the block column's `columnOrder`, moved to its own
   module so both share one implementation.

8. **Overflow is reported, never fixed.** `overflow` is how far the flow and its padding run past
   the area's definite size, or past a bounded room when the area hugs — what `stackIn` and
   `rowIn` reported. The area shrinks nothing; fitting stays with `fittedColumn`.

9. **`stackIn`, `rowIn` and `insetIn` are shortcuts.** `stackIn` is a column that fills the room's
   width and never collapses, `rowIn` a row that fills its height, `insetIn` a hugging column
   with padding. The area keeps their arithmetic — each offset a sum added at a time, `y + (size
   - gap)`, the length `y + (last + gap) − gap`, padding added as `start + offset` — so their
drafts are equal to the older code's (`arrangement.test.ts`, with sizes whose sums round
     differently by grouping) and the published templates built on the new kit render the same
     bytes (TYTO-912's pull request names the trees compared).

10. **Core and plugin-api do not change.** Everything happens inside a template's `build`, from
    `Area`, `Block` and drafts the kit already has.

## What this record does not decide

- The area drawing its own box — fill, stroke, radius per corner, shadow (TYTO-913).
- A grid, a wrapping row, and a row aligned by its capitals' baseline (TYTO-914); `flow` is where
  they enter.
- Children repeated over a brief list, and the outline of each area with its name in guide mode
  (TYTO-915); `children` is a plain list a repeat can produce.
- What a template does with an overflow (warn, fit, let it grow), and whether `blockColumn` and
  `fittedColumn` become areas.
- The name an author or the editor shows for an area ("área", "grupo", by role).

## Consequences

- A template composes its layout as areas inside areas over the frame, and an optional field the
  brief left out leaves no hole and no gap.
- A child is built once in the common case; a held hugging child and a fill child that turns out
  absent (its share is split again among the others) cost one more build.
- The shortcuts stay in the kit with their names and schemas; ADR 0230 decision 3's wrappers are
  unaffected.
