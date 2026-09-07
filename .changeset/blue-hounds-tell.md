---
'@tyto/core': minor
---

Add the project's format catalogue, `formats.yaml`.

`parseFormats(source, path)` and `loadFormats(fileSystem, path)` read a mapping of format
id to `{ w, h, label? }` — the one place a number like 1080×1920 is written. `compile` now
takes a `FormatCatalogue` and hands each template call `context.size`, so a template states
its layout and not its canvas, and two templates cannot disagree about what `story` is. A
template rendering a format the project does not define is `E_FORMAT_NOT_DEFINED`, raised
once before any frame is built.

The YAML-to-diagnostic machinery `parseManifest` used is now shared
(`src/config/yaml-source.ts`), so both files report the path of the offending key and a
range over its value the same way.

New diagnostic codes: `E_FORMATS_SYNTAX`, `E_FORMATS_SHAPE`, `E_FORMAT_NOT_DEFINED`.
`compile` takes a third argument.
