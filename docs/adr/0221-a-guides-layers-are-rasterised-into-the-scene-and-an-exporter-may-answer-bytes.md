# 0221 — A guide's layers are rasterised into the Scene, and an exporter may answer bytes

Status: accepted · 2026-11-19 · TYTO-740 · builds on ADR 0007, ADR 0041, ADR 0050 and ADR 0220

## Context

ADR 0220 gave a template a way to declare art painted outside Tyto, and its note gave
`compile(..., { guide: true })` a `frame.guide`: the frame cut into four layers, `texto`,
`areas`, `arte` and `decoracao`, each naming the frame's own top-level nodes. The file a
designer opens is a PSD with those layers as pictures. Two things stand between the guide's
Scene and that file.

An exporter answers `Result<string>`. A string is right for HTML and SVG, and wrong for a
binary format: a PSD squeezed through a string is an encoding everybody would have to agree on,
and no consumer wants it.

And a layer is a picture, which only a browser draws today, through the `Rasterizer` port. An
exporter may not reach for a browser: exporters receive only a `Scene` (`AGENTS.md`, hard
rules), and `export-*` stays pure. If something must appear in the output, it enters the IR
first.

## Decision

1. **An exporter may answer a file's bytes.** `Exporter.exportFrame` returns
   `Result<ExportedFrame>`, where `ExportedFrame` is `string | Uint8Array`. A string is a
   document, as before; a `Uint8Array` is the file. The job hands bytes to the sink as they
   came, and a `rasterized` exporter that answers bytes fails that frame with `E_RENDER_FAILED`,
   since there is no document to raster. Every built-in still answers a string, so nothing they
   produce changes.

   Across the isolation boundary the answer's schema is `string | Uint8Array`
   (`isolation/points.ts`); the desktop's JSON channel already carries any `Uint8Array` as
   plugin-wire's `$tytoBytes` marker (ADR 0050), so the adapter does not change. The schema
   does: a host on 28 refuses a byte answer, and a guest on 28 refuses a frame whose guide
   layer carries `raster` (decision 2). So `RPC_PROTOCOL_VERSION` moves from 28 to **29**, and
   `@tyto/plugin-api` takes a minor (ADR 0149).

2. **A pipeline stage rasterises a guide's layers into the Scene.** `rasterizeGuideLayers` in
   `@tyto/pipeline` runs after the resources are loaded and before the first export, when any
   frame has a `guide`; `JobRequest.guide` asks `compile` for one. For each layer except `arte`
   — where the designer paints, so it has nothing to draw — it exports the same frame through
   the exporter the job's registry answers for `png`, which must be `rasterized`, with every
   top-level node outside the layer `visible: false` and no background, rasterises the document
   through the `Rasterizer` port as a PNG at the frame's size and scale 1, and records the
   picture as the layer's `raster`: an `AssetRef` with `source: 'inline'`, id
   `guide-layer:<artwork>:<format>:<layer>`, the PNG's size and a content hash. The frame's
   background is no node, so no layer names it (ADR 0220's note); it is painted into
   `decoracao`, the layer under the art.

   - **Hidden, not removed.** Every node is absolutely placed (`RESET` in `export-html`), so
     `display: none` moves no other node, and a mask's root is drawn whatever its `visible`
     says. Measured for this decision in Chrome: the one visible node's box is the same
     `120,20 40×30` in the whole frame and in its layer.
   - **The scale is 1 and the size the frame's, rounded.** The port takes whole pixels and any
     finite positive scale; a guide is painted at the format's size, which is the frame's.
   - **The bytes travel like a loaded asset's.** The stage cannot write into the store the
     exporters' resolvers read, which is the composition root's; so the job hands the rasters
     to a new port, `JobPorts.storeAssets`, which puts each under its ref's id, and the
     exporter asks for a raster as it asks for a picture. `sceneResources` does not list them:
     they do not exist when the loader runs.
   - **A layer that cannot be drawn** is one `E_RENDER_FAILED` (`frame` `<artwork>:<format>`,
     kind `the guide layer '<name>'`); it keeps no raster and the others go on. A job with a
     guide and no `png` rasterized exporter or no rasterizer says so once, the same code.
   - **A Scene with no guide** is returned as the same object: a render that is not a guide
     pays nothing and its bytes do not change.
   - `GuideLayer` gains `raster?: AssetRef` in `@tyto/core`; only this stage sets it.

3. **The PSD exporter (next pull request) uses `ag-psd`, and is handed pixels.** `ag-psd` is
   MIT, pure JavaScript with no peer dependencies, and writes without a canvas:
   `writePsdUint8Array` with each layer's `imageData` as RGBA. The exporter stays pure: it reads
   each layer's `raster` from the Scene and asks a **pixels port bound at registration**, as
   the HTML exporter is bound to its resources, for that ref's decoded RGBA. The host
   implements the port by decoding the stored PNG with `pngjs`, already in the lockfile.

## Rejected

- **The exporter calls a painter port itself.** A PSD exporter handed a "draw this layer"
  function would produce pixels nothing in the IR describes: two runs could differ with no
  Scene to compare, and an exporter would depend on a browser. Pixels enter the IR before the
  exporter, which is the rule.
- **A data URI or base64 in a string answer.** Every consumer would decode it again, and a
  `mime` that says `image/vnd.adobe.photoshop` over a string that is not the file is a lie
  the sink would have to know about.
- **Removing the other nodes instead of hiding them.** It changes the frame's node list,
  which a mask may point into; hiding leaves the frame whole.

## Consequences

- An installed exporter can write any binary format; the built-ins are unchanged.
- A guide render costs one raster per painted layer per frame (three for a `full` canvas, none
  for an `inline` one), in sequence, before the render; a render without a guide costs nothing.
- The CLI and the desktop wire `storeAssets` and `guide` when the PSD lands (the fifth pull
  request of TYTO-740); until then nothing asks for a guide.
