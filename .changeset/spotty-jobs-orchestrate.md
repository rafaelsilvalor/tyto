---
'@tyto/pipeline': minor
'@tyto/core': minor
---

`runJob`: a brief in, artifacts out. It composes `parseBrief` → `resolve` → `compile` → `export` → `raster` with every capability injected as a port, names each artifact `<artwork>-<format>.<ext>` (ADR 0011), limits how many frames raster at once, and reports progress through a tagged `JobEvent` union. A three-slide brief in two formats asked for as PNG and SVG produces twelve files.

Two ports are declared here because nothing else could: `TemplateSource`, since `TemplateRegistry` reads manifests and `compile` needs a build function, and `ArtifactSink`, implemented by `io` in E6.2 — a job with no sink returns its artifacts in memory and opens no files. Every frame is attempted individually with `exportFrameHtml`/`exportFrameSvg`, so one broken frame of twelve is reported alongside the other eleven instead of replacing them; an `AbortSignal` stops the job handing anything further to the sink.

`@tyto/core` gains two diagnostic codes for what a job can report and no stage could: `E_RENDER_FAILED` for a frame that produced no bytes, and `E_OUTPUT_WRITE` for one that could not be written.
