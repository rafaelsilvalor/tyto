# @tyto/house-style

## 0.2.0

### Minor Changes

- 46a0b89: TYTO-438: a template's manifest may declare what a configuration can change in it, under `values` — each a `color`, `length`, `number`, `face` or `image`, with its default and, for a length or a number, its limits (ADR 0153). `compile` hands the template the resolved values as `context.values`, the defaults overlaid by `CompileOptions.values`, and a supplied value the template did not declare, of the wrong kind or outside its limits is a warning at its range (`W_TEMPLATE_VALUE_UNKNOWN`, `W_TEMPLATE_VALUE_INVALID`) while the default stands. A template reads them with `numberValue`, `colorValue`, `faceValue` and `imageValue` from `@tyto/core/template`. `compileTemplate` in `@tyto/template-kit/testing` takes `values`. The house's one-image table reads its title gap, title and body size limits, optical drop and colours this way (`TABLE_VALUE_DEFAULTS`), and the built-in `tabela-roxo` declares them, drawing the same bytes when nothing is configured. Nothing reads a plugin file's configuration yet (TYTO-439), and values do not cross to a template in a plugin's process yet.

### Patch Changes

- Updated dependencies [7115286]
- Updated dependencies [46a0b89]
  - @tyto/core@0.30.0
  - @tyto/template-kit@0.4.0

## 0.1.0

### Minor Changes

- 8ece763: TYTO-431: the house's tokens, presets and shared parts — the table, the agenda composition, the seal, the brands, the line breaks — leave the `_casa` folder of `@tyto/templates` for a pure package of their own, `@tyto/house-style` (ADR 0151). It is published with the plugin contract as `@rafaelsilvalor/tyto-house-style`, after `@tyto/template-kit`, so a template in its own repository can depend on it by version. The table's tokens are the subpath `@tyto/house-style/table-tokens`. The built-in templates import it by name and render the same bytes.

### Patch Changes

- Updated dependencies [dfbadc7]
  - @tyto/template-kit@0.3.0
