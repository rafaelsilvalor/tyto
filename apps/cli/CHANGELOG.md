# @tyto/cli

## 0.2.4

### Patch Changes

- 63f24dc: TYTO-174 — `tyto render` places a markup template's diagnostics in `template.html` again. The
  brief's origin was registered over the one `templateWiring` had already recorded, so a
  broken tag on line 15 of the template printed as `promo.brief:15:1`: a real line of a file
  with nothing wrong in it. The first registration now wins, which is what the comment beside
  the second one always said.
- Updated dependencies [8b24969]
  - @tyto/core@0.24.0
  - @tyto/export-html@0.6.1
  - @tyto/export-svg@1.3.1
  - @tyto/io@1.3.5
  - @tyto/pipeline@0.8.2
  - @tyto/plugin-api@0.3.7
  - @tyto/raster@0.2.1
  - @tyto/template-lang@0.6.4
  - @tyto/templates@0.4.1

## 0.2.3

### Patch Changes

- Updated dependencies [80a03a8]
- Updated dependencies [d3587dd]
  - @tyto/core@0.23.0
  - @tyto/export-html@0.6.0
  - @tyto/export-svg@1.3.0
  - @tyto/templates@0.4.0
  - @tyto/io@1.3.4
  - @tyto/pipeline@0.8.1
  - @tyto/plugin-api@0.3.6
  - @tyto/raster@0.2.1
  - @tyto/template-lang@0.6.3

## 0.2.2

### Patch Changes

- Updated dependencies [353c83d]
  - @tyto/pipeline@0.8.0
  - @tyto/templates@0.3.0
  - @tyto/core@0.22.2
  - @tyto/io@1.3.3
  - @tyto/export-html@0.5.5
  - @tyto/export-svg@1.2.3
  - @tyto/plugin-api@0.3.5
  - @tyto/raster@0.2.1
  - @tyto/template-lang@0.6.2

## 0.2.1

### Patch Changes

- Updated dependencies [91b6bc5]
  - @tyto/core@0.22.1
  - @tyto/io@1.3.2
  - @tyto/plugin-api@0.3.4
  - @tyto/pipeline@0.7.2
  - @tyto/export-html@0.5.4
  - @tyto/export-svg@1.2.2
  - @tyto/raster@0.2.1
  - @tyto/template-lang@0.6.1

## 0.2.0

### Minor Changes

- 5309eb2: TYTO-107 — a stage may produce a value and still report errors

  The preview keeps drawing while one directive is half-typed: an unclosed `**` costs that
  directive and nothing else, so the artwork stays on screen and the problems panel names what
  is wrong (ADR 0025). TYTO-108 marked the last good preview as stale; this renders the
  current one, minus the broken part.

  `tyto render` agrees with it. A brief with an unknown slot writes its artifacts, exits 1, and
  its `result.json` is `status: error` with those files listed — _rendered, with errors_, which
  `docs/render-contract.md` now describes.

  A brief with no usable template still renders nothing, and so does one whose frontmatter will
  not parse or that leaves a required slot unset. The gap has to be visible in the artwork
  before a missing required slot can be skipped, and nothing draws it yet.

### Patch Changes

- Updated dependencies [e3f2adc]
  - @tyto/raster@0.2.1
  - @tyto/io@1.3.1
  - @tyto/pipeline@0.7.1

## 0.1.13

### Patch Changes

- Updated dependencies [9b44b9d]
  - @tyto/core@0.19.0
  - @tyto/export-html@0.4.2
  - @tyto/export-svg@1.0.2
  - @tyto/io@1.0.3
  - @tyto/pipeline@0.5.3
  - @tyto/plugin-api@0.2.7
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.7

## 0.1.12

### Patch Changes

- Updated dependencies [4519c36]
  - @tyto/core@0.18.0
  - @tyto/export-html@0.4.1
  - @tyto/export-svg@1.0.1
  - @tyto/io@1.0.2
  - @tyto/pipeline@0.5.2
  - @tyto/plugin-api@0.2.6
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.6

## 0.1.11

### Patch Changes

- @tyto/io@1.0.1
- @tyto/pipeline@0.5.1

## 0.1.10

### Patch Changes

- Updated dependencies [f0d3d25]
  - @tyto/core@0.17.0
  - @tyto/pipeline@0.5.0
  - @tyto/io@1.0.0
  - @tyto/export-svg@1.0.0
  - @tyto/export-html@0.4.0
  - @tyto/plugin-api@0.2.5
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.5

## 0.1.9

### Patch Changes

- Updated dependencies [a40f4d9]
  - @tyto/core@0.16.0
  - @tyto/export-html@0.3.4
  - @tyto/export-svg@0.2.4
  - @tyto/io@0.4.5
  - @tyto/pipeline@0.4.3
  - @tyto/plugin-api@0.2.4
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.4

## 0.1.8

### Patch Changes

- Updated dependencies [04c076c]
  - @tyto/core@0.15.0
  - @tyto/io@0.4.4
  - @tyto/pipeline@0.4.2
  - @tyto/export-html@0.3.3
  - @tyto/export-svg@0.2.3
  - @tyto/plugin-api@0.2.3
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.3

## 0.1.7

### Patch Changes

- Updated dependencies [15dfa8b]
  - @tyto/core@0.14.1
  - @tyto/export-html@0.3.2
  - @tyto/export-svg@0.2.2
  - @tyto/io@0.4.3
  - @tyto/pipeline@0.4.1
  - @tyto/plugin-api@0.2.2
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.2

## 0.1.6

### Patch Changes

- Updated dependencies [2f72340]
  - @tyto/core@0.14.0
  - @tyto/pipeline@0.4.0
  - @tyto/export-html@0.3.1
  - @tyto/export-svg@0.2.1
  - @tyto/io@0.4.2
  - @tyto/plugin-api@0.2.1
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.1

## 0.1.5

### Patch Changes

- Updated dependencies [81026df]
  - @tyto/export-html@0.3.0
  - @tyto/io@0.4.1
  - @tyto/pipeline@0.3.0
  - @tyto/raster@0.1.0

## 0.1.4

### Patch Changes

- Updated dependencies [b5e8b1b]
  - @tyto/io@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies [607f8e1]
  - @tyto/plugin-api@0.2.0
  - @tyto/pipeline@0.3.0
  - @tyto/export-html@0.2.0
  - @tyto/export-svg@0.2.0
  - @tyto/io@0.3.0
  - @tyto/raster@0.1.0

## 0.1.2

### Patch Changes

- Updated dependencies [a0a6155]
  - @tyto/template-lang@0.2.0
  - @tyto/io@0.2.1
  - @tyto/pipeline@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [e994ca9]
  - @tyto/core@0.13.0
  - @tyto/pipeline@0.2.0
  - @tyto/io@0.2.0
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.1.3
