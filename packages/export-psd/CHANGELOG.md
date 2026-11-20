# @tyto/export-psd

## 0.1.1

### Patch Changes

- Updated dependencies [422cf7c]
  - @tyto/plugin-api@0.28.0

## 0.1.0

### Minor Changes

- 279b6c1: A new exporter, `@tyto/export-psd`, writes a guide frame (ADR 0220) as a layered PSD with
  `ag-psd` and no canvas (ADR 0221): the frame's size, the guide's layers top to bottom, each
  named by its label, with its lock, visibility and opacity, every painted layer as the pixels
  the host decodes from its `raster` through `PsdResources`, `arte` empty, and a flattened
  composite of the visible layers. A frame without a guide, or a painted layer without pixels,
  is a diagnostic and no file. Nothing registers it yet; the CLI does in the next pull request.

### Patch Changes

- Updated dependencies [833e7ec]
- Updated dependencies [7e43e5c]
- Updated dependencies [6465865]
- Updated dependencies [cfd96ff]
- Updated dependencies [6f50dd3]
- Updated dependencies [0f19f1f]
  - @tyto/core@0.54.0
  - @tyto/plugin-api@0.27.0
