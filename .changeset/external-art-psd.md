---
'@tyto/export-psd': minor
---

A new exporter, `@tyto/export-psd`, writes a guide frame (ADR 0220) as a layered PSD with
`ag-psd` and no canvas (ADR 0221): the frame's size, the guide's layers top to bottom, each
named by its label, with its lock, visibility and opacity, every painted layer as the pixels
the host decodes from its `raster` through `PsdResources`, `arte` empty, and a flattened
composite of the visible layers. A frame without a guide, or a painted layer without pixels,
is a diagnostic and no file. Nothing registers it yet; the CLI does in the next pull request.
