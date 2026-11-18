---
'@tyto/core': minor
'@tyto/recipe': minor
'@tyto/io': minor
'@tyto/plugin-api': minor
'@tyto/command-line': patch
---

A delivery's exports are checked against its record (TYTO-757, ADR 0215). `deliveries` gives
every row `check` (`ready`, `incomplete` or `in-progress`), `check_problems`, each problem
named, and `found_formats`, the shapes of the PNG and JPEG images at the root of the
delivery's `exports` folder, read from their headers. The project file's `delivery.sizes`
gives each format name its pixel size; a name it leaves out falls back to the format
catalogue, which `tyto recipe run` and `tyto mcp` lend. `core` owns the one shape snapping,
`aspectOf` and `aspectsText`, which `@tyto/plugin-api` re-exports for plugins. A declared
field can no longer be named `check`, `check_problems` or `found_formats`.
