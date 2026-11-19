# 0220 — A slot may declare art painted outside Tyto

Status: accepted · 2026-11-19 · TYTO-740 · builds on ADR 0025, ADR 0035, ADR 0048 and ADR 0158

## Context

Some pieces carry art nobody draws with Tyto: a background or an illustration a designer
paints in an image editor, to the template's layout. TYTO-740 is the first of five pull
requests that let a template say so and let Tyto write the designer a layered guide for it.
This record is the first one's: what a manifest declares, and what a render draws before the
file exists. The guide itself is the next ones'.

Two facts set the shape. The designer paints to a size, so the size is part of the
declaration, per format, because a story and a square post are painted separately. And a
render made before the art exists is the normal case while the piece is being made, so it
must render and say where the art goes. A blank where the art should be is the silent hole
ADR 0035 removed: it looks finished.

## Decision

1. **An `image` slot may declare `external`.** In `manifest.yaml`:

   ```yaml
   fundo:
     type: image
     external:
       kind: full
       sizes:
         grid-1x1: { width: 1080, height: 1080 }
         story: { width: 1080, height: 1920 }
   imagem:
     type: image
     external:
       kind: inline
       sizes:
         story: { width: 920, suggestedHeight: 1080 }
   ```

   `full` art covers the format, so it states `height`; `inline` art sits among the other
   pieces, as wide as the template says and as tall as the person painting it decides, so it
   states `suggestedHeight`, where they start from. Neither takes the other's key. The manifest
   parse refuses, each at its key: `external` on a slot that is not an image; on a slot that
   repeats, belongs to each slide or takes several values (a carousel would need a canvas per
   slide too, which nothing has decided); a format the manifest does not render; a format it
   renders that `sizes` leaves out. A manifest without `external` parses to the object it did.

2. **`full` art keeps the format's proportion.** Its height in a format is its width times the
   format's height over its width, within a pixel for rounding. The format's size is the
   project's `formats.yaml`, which the manifest's parse never reads, so `compile` checks it
   before it builds anything and refuses with `E_EXTERNAL_ART_ASPECT`, fatal, as it refuses a
   format with no size (`E_FORMAT_NOT_DEFINED`). It carries the slot's range in the brief when
   the brief wrote the slot; a manifest fault has no other place in a brief to point at.

3. **A brief with no file yet renders, and warns.** When the brief names no file for an
   external slot, or names one that is not there, `resolve` reports `W_EXTERNAL_ART_MISSING`
   (at the directive, or at the frontmatter when nothing named it) and gives the slot a
   placeholder ref (`source: inline`, id `external-art:<slot>`, no path). An external slot is
   never `E_MISSING_REQUIRED_SLOT` and never stamps the frame: the art is late by design, not
   forgotten, and the box below already marks its place. The placeholder never enters
   `ResolvedBrief.assets` nor `Scene.assets`, so no job asks for its bytes.

4. **The template places the placeholder as it places a picture.** `compile` sets the
   placeholder's `size` per format from the declaration (`full`'s width × height, `inline`'s
   width × suggestedHeight), so a template that sizes a picture by its ref (ADR 0158) sizes the
   placeholder to the declared art. The layout and the stacking are the template's own.

5. **`compile` draws the placeholder as an outlined empty box.** After the template answers,
   every image node drawing a placeholder becomes a rect with the node's id, transform, size,
   opacity, mask and effects, no fill, and a magenta outline (the gap colour, ADR 0035) inside
   its edge, named `external-art:<slot>`. A shape painted with it keeps its geometry and loses
   the paint; a frame background painted with it becomes a box the size of the frame, under
   everything else. Exporters draw rects already, so no exporter changes. An installed
   template in its own process (ADR 0048) receives the placeholder in `slots` and sends the
   image node back through the strict frame schema; the swap runs on the host's side, after
   the answer, so the isolation protocol does not change.

## What follows, recorded for the next pull requests

- **The guide's Scene (next pull request).** For each format, the template's own frame with
  the art's boxes, turned into layers. Top to bottom: `texto` (everything painted above the
  art, text and shapes alike, rasterised, locked), `areas` (each external slot's box outlined
  and named, locked, at 50% opacity), `arte` (empty: where the designer paints), `decoracao`
  (every shape painted under the art, hidden, locked). An `inline` slot is a canvas of its own
  per format, width × suggestedHeight, with only `arte`, the width in the layer's name.
- **The PSD exporter and its pixels (the two after it, ADR 0221).** Pixels enter the IR before
  the exporter: a pipeline stage rasterises each layer into the Scene, and the exporter that
  writes the PSD stays pure, as every exporter is. ADR 0221 records it.
- **Naming the art per format** is open: a brief names one file per slot today, drawn into
  every format's box. How a brief points at a story's art and a square post's separately is
  decided with the guide.

## Consequences

- A template author writes the size the designer paints to once, in the manifest, and every
  render shows where the art goes until it exists.
- A brief that never names the art renders with one warning per external slot and no error; one that names a
  file still missing says which file and where it was looked for.
- A template that draws the art as a frame background loses that background to a box while
  the file is missing; one that draws it as an image node keeps its stacking exactly.
