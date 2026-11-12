# 0053 — An exported file is named by its format and its number

Status: accepted · 2026-09-28 · TYTO-197 · amends ADR 0011's file naming

## Context

ADR 0011 fixed the output folder as a contract, and E6.1 named each file
`<artwork>-<format>.<ext>`: `lamina-1-grid.png`, `artwork-1-grid-1x1.svg`. The artwork's id
comes from the repeatable slot's name, so the file name carried a word from the brief's
vocabulary (`lamina`, before TYTO-157 `slide` or `item`) that says nothing to the person who
opens the delivery.

On 2026-09-28 the maintainer asked for exports named just "01, 02, 03…". Asked how two formats
of one template should not collide, he first chose a folder per format and then settled on flat
files with the format first: "tudo solto coloca grid-01, grid-02… story-01, story-02…".

## Decision

**A file is `<format>-<NN>.<ext>`**: `grid-01.png`, `grid-1x1-01.svg`, `story-02.png`. One rule
for one format or many, and every type of one artwork shares the base name.

**`NN` is the artwork's place in the delivery**, counted from 1 and padded so every file of one
delivery has the same width: two digits, and three only once a delivery passes 99 artworks
(manifests cap a carousel at 12 today). A fixed width keeps a folder sorted by name in slide
order.

**The artwork's id leaves the file name, not the contract.** `result.json` still lists each
artifact's `artwork` beside its `name`, so a program maps `grid-02.png` back to `lamina-2`
without parsing names. The format stays sanitized exactly as before; the number needs none.

**SVG element ids keep the artwork's id** (`lamina-1.grid.…`). They belong to the scene, not to
the file, and they must stay unique across artworks and formats.

## Consequences

Every delivery's file names change once more after TYTO-194, and nothing else does: all
fourteen files of the built-in examples render pixel-identical under their new names. The two
land in one release, so a script or a person meets a single change.

**A re-export into a folder that holds a delivery from before this change leaves the old files
beside the new ones.** Measured: the agenda example rendered by main and then by this change
into one folder holds `grid-01.png`, `grid-02.png`, `lamina-1-grid.png`, `lamina-2-grid.png` and
`result.json`, and `result.json` lists only the two new files. Before, the same brief re-rendered
into its own folder overwrote every file. This is TYTO-127's "a re-export leaves older files",
made to happen once per folder across the upgrade; the cleanup rule is TYTO-127's to decide, and
this decision does not change it.

## Note, 2026-11-12 — accents keep their letter, and Windows device names are avoided (TYTO-640)

The format part of a file name is sanitised by core's `fileSafeName`, which `to-brief` shares
(ADR 0172). It now keeps the base letter of an accented Latin letter instead of collapsing it to
`-`, drops a trailing dot or space, and gives a Windows device name (`CON`, `NUL`, `COM1`…, any
case, with or without an extension) a `_` on its stem. **Delivery names change with it**: a
format named `miniatura-vídeo` is delivered as `miniatura-video-01.png`, where it was
`miniatura-v-deo-01.png`. One rule for both callers was kept on purpose, so a format and a row
spelled alike name their files alike. A format id that was already ASCII-safe is delivered
under the same name, byte for byte. As in the Consequences above, a re-export into a folder
from before the change leaves the old accented-format files beside the new ones.
