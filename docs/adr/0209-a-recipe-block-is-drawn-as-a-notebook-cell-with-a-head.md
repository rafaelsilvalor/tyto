# 0209 — A recipe block is drawn as a notebook cell, with a head

Status: accepted · 2026-11-17 · TYTO-767 · amends ADR 0195 on how a block is drawn · builds on
ADR 0196 and ADR 0208

## Context

ADR 0195 drew a recipe's blocks as a quiet band behind each line, with a left bar and a hairline
over each block's first line; the toolbar sat at the right of the first line and the counter in
the gutter beside it. Results are block widgets between lines, outside the band.

On 2026-11-17 the maintainer found it hard to tell where one block starts and another ends, and
asked for something closer to Jupyter's cells, within the UI Tyto has. TYTO-766 (ADR 0208) made
it worse in one case: a plan drawn under a middle step's line broke the band, so the line after
it read as a new block.

Measured in the window (captures before and after, both themes, in the PR): the band was a few
shades off the editor's background, invisible in the light theme, and no result was inside any
block's shape. Decided with the maintainer on those captures, in three rounds: a box, more space
between blocks, notes with no box, and a head at the top of each block.

## Decision

1. **A block is a box** drawn by the editor package in a layer of its own (`cm-notebook-boxes`),
   from the top of its first line to the bottom of the last result under its last line, middle
   plans (ADR 0208) included. It is an outline with no fill, over the text and under the
   toolbars, the "+" and the drop line, and lets every click through. CodeMirror stacks layers by
   the order they are given (measured: the first given gets `z-index` 150), so the box layer is
   given last.
2. **The box shows state as Jupyter does**: a thicker left bar, in the accent colour on the block
   holding the caret, and the whole outline in the accent colour on the block command mode
   selected. The lines keep their band, as a cell's input area.
3. **A step block has a head**: a strip above its first line, inside its box, holding the
   counter at the left and the toolbar at the right, so neither sits beside the text. It is the
   first line's top padding (CodeMirror measures it); a frame says `headed`, and the host says
   where its headed blocks start (`headedLinesOf`, from the state), so the line-number gutter
   puts the number beside the text and not in the head.
4. **A note block is prose, with no box and no head**, as a notebook's text cell; command mode
   still rings a note it selected. The header block has neither: it is the recipe's title.
5. **Blocks stand further apart**: the blank lines between two frames carry `cm-notebook-gap`,
   which the window pads.
6. Nothing changes on disk, in command mode, in dragging or in the "+": the box and the head are
   drawing only.

## Consequences

- A block reads as one shape with its results, in both themes.
- The first line of a step block is taller by the head's height; a test that compared a line's
  top with its counter or toolbar still finds them there, since both sit at the line's top.
- A note does not render Markdown: it is plain text in the window's font. Rendered notes would be
  a card of their own.
