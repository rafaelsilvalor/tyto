# @tyto/house-style

## 0.3.0

### Minor Changes

- 4388575: TYTO-455 (ADR 0155): a plugin file's configuration picks its brand, and the brand kit carries the brand's accent. A configuration may write `brand:`; the template is then handed that brand's kit in `context.brand` instead of its manifest's — the configuration's own brand, else its entry `default`'s, else the manifest's. A brief cannot name a brand. `@tyto/core`'s `BrandKit` gains `colors?: { accent? }` (`BrandColors`, `brandColorsSchema`; closed and strict, a hex accent only), `TemplateSelection` and `ResolvedBrief` gain `brand`, `resolveTemplateConfigurations` takes optional `kitBrands`, and two warnings join: `W_CONFIGURATION_BRAND_INVALID` for a brand spelled against the manifest's rule, and `W_BRAND_KIT_MISSING` at the plugin file's line for a brand no installed kit offers (a manifest's brand with no kit stays silent). `@tyto/plugin-api`'s `parsePluginFile` keeps `brand` with its range. **The isolation protocol is 11**, because a kit with colours crosses in the strict template-call and `brand-kit` schemas: a plugin process on 10 is refused at `hello`, and this release is the breaking minor ADR 0149 point 4 requires. After it is published, the contract-update workflow (ADR 0154) opens the pull request that moves `tyto-template-tabela`, `tyto-template-concursos-abertos` and the plugin repositories onto it. `@tyto/house-style` adds `accentOf(kit, fallback)`, and the house's compositions (`simuladosDaSemana`, `oneImageTable`, `productBanner`) draw the kit's accent over their own; the built-in templates, azul's `agenda-semana` and `aprovados` included, do the same, with today's colour as the fallback, so every render without a kit is byte-identical. `tyto render` passes the installed kits' brands, so the CLI reports `W_BRAND_KIT_MISSING`; the desktop already draws a configuration's kit, and reports the warning in a later change. The manual's Plugins page describes it in both editions.

### Patch Changes

- Updated dependencies [c590e01]
- Updated dependencies [e7588e9]
- Updated dependencies [4388575]
- Updated dependencies [e2b72a7]
  - @tyto/core@0.32.0
  - @tyto/template-kit@0.4.2

## 0.2.1

### Patch Changes

- Updated dependencies [a5912e7]
  - @tyto/core@0.31.0
  - @tyto/template-kit@0.4.1

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
