# 0093 — The docks yield before the editor groups

Status: accepted · 2026-10-17 · TYTO-299 · amends ADR 0024 (a dock's size is where it starts) and
ADR 0083 point 1 (the groups' minimum is honoured by the layout, not only by a drag)

## Context

At 900x600 (the window's minimum; a 902x602 viewport at 125 % scaling) with the queue in the
left dock (340 px), a plugin's panel in the right one (320 px), and the editor split right with
the left side split down again, the centre dock was 239.6 px wide. The right group kept its
160 px minimum, the column of two beside it got 78.6 px, and the 160 px groups inside the column
spilled out of it: **the right group was painted 80.4 px over both groups of the column**.
Measured with `getBoundingClientRect` on `origin/main` e39f1d7 on 2026-10-17, the same numbers
the card recorded on 1cc9e8e.

The cause, read in the stylesheet and confirmed by the numbers: every box between the centre
dock and an editor group — `.dock`, `.panel`, `.editor-groups`, `.editor-split` — carried
`min-width: 0`, and only the leaf `.editor-group` had a minimum. A split could therefore be
narrower than what it holds, and the next sibling in its row was drawn on top. The side docks
were `flex: 0 0 auto` with a width in pixels from the record, so they never gave way; nothing
did except the editor.

`group-resize.ts` (TYTO-289) already knew what a split needs, `minimumOf`, but only a drag used
it.

## Decision

1. **A split is never smaller than its groups at their minimum.** `arrangeGroups` writes each
   split's `min-width` and `min-height` from `footprintOf` — `minimumOf` plus one hairline per
   line between children laid end to end — and publishes the root's footprint as
   `--tyto-groups-min-width` and `--tyto-groups-min-height` on `.workspace`. A drag keeps to
   `minimumOf`: it moves one line between two neighbours and never the lines themselves.
2. **The docks give way first.** The centre dock is held at the groups' width and the docks'
   row at their height. The side docks and the bottom dock are `flex: 0 1 auto`: the size in the
   record is where they start, and they shrink to make the room, each down to the smaller of that
   size and `--tyto-dock-min-width` (160 px, a group's width) or `--tyto-dock-min-height` (96 px,
   a group's height). The smaller of the two so that a dock a person dragged narrower than the
   floor keeps its own size. **The record is not changed**: a wider window gives the docks their
   size back, and a drag starts from the box measured on screen, as it always did.
3. **Past that, the groups are clipped, never overlapped.** The centre dock's floor is capped at
   what is left after each open dock keeps its own floor and line, so a dock is never pushed out
   of the window; the groups keep their minimum and the last ones are cut at the centre dock's
   far edge, as VS Code does. `.editor-groups` is `overflow: clip`, not `hidden`: a hidden box can
   be scrolled, and a pane brought into view — CodeMirror does it for its caret — slid the first
   groups' tab strips out above the dock (measured: group 1 at y −193 under a dock top at 33).
   ADR 0083's "no limit on groups" stands; what a window too small shows is less of them, not
   them on top of each other.
4. **The window's minimum stays 900x600.** Raising it to fit every arrangement would make the
   window's size depend on how many groups are open; the clip is the answer instead.

## Consequences

- Measured at 900x600 in the scene above after the change: left dock 298.1 px, centre 321 px,
  right dock 280.5 px; the three groups 160 x 203.3, 160 x 203.3 and 160 x 407.6, no two
  intersecting (`e2e/pane-shape.desktop.test.ts`, "a window too narrow for every pane").
- With six groups stacked and four side by side, both docks sit at 160 px and the bottom one at
  96 px, every dock ends inside the window, and the groups are clipped at the centre's right and
  bottom edges.
- The floor the centre keeps for a dock is the token, not that dock's own smaller size, so a dock
  dragged below 160 px reserves a little more than it uses and the groups are clipped a little
  sooner. Exact reservation would need the docks' sizes in the stylesheet; not done.
- `SPLITTER_THICKNESS` in `group-resize.ts` repeats `--tyto-hairline-width`;
  `e2e/renderer-tokens.test.ts` holds the two equal, as it does `GROUP_MINIMUM`.
