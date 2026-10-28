# @tyto/house-style

## 0.1.0

### Minor Changes

- 8ece763: TYTO-431: the house's tokens, presets and shared parts — the table, the agenda composition, the seal, the brands, the line breaks — leave the `_casa` folder of `@tyto/templates` for a pure package of their own, `@tyto/house-style` (ADR 0151). It is published with the plugin contract as `@rafaelsilvalor/tyto-house-style`, after `@tyto/template-kit`, so a template in its own repository can depend on it by version. The table's tokens are the subpath `@tyto/house-style/table-tokens`. The built-in templates import it by name and render the same bytes.

### Patch Changes

- Updated dependencies [dfbadc7]
  - @tyto/template-kit@0.3.0
