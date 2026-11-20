# @tyto/house-style

## 0.6.8

### Patch Changes

- Updated dependencies [2df7157]
- Updated dependencies [2decc39]
  - @tyto/core@0.55.0
  - @tyto/template-kit@0.15.0

## 0.6.7

### Patch Changes

- Updated dependencies [f7eda34]
  - @tyto/template-kit@0.14.0

## 0.6.6

### Patch Changes

- Updated dependencies [033e2d2]
  - @tyto/template-kit@0.13.1

## 0.6.5

### Patch Changes

- Updated dependencies [833e7ec]
- Updated dependencies [7e43e5c]
- Updated dependencies [6465865]
- Updated dependencies [cfd96ff]
- Updated dependencies [6f50dd3]
- Updated dependencies [0f19f1f]
- Updated dependencies [b3aa927]
  - @tyto/core@0.54.0
  - @tyto/template-kit@0.13.0

## 0.6.4

### Patch Changes

- Updated dependencies [c3fc939]
- Updated dependencies [5f0d18c]
- Updated dependencies [912e97e]
  - @tyto/core@0.53.0
  - @tyto/template-kit@0.12.9

## 0.6.3

### Patch Changes

- Updated dependencies [48cca9b]
  - @tyto/core@0.52.0
  - @tyto/template-kit@0.12.8

## 0.6.2

### Patch Changes

- Updated dependencies [0057d72]
  - @tyto/core@0.51.2
  - @tyto/template-kit@0.12.7

## 0.6.1

### Patch Changes

- Updated dependencies [99e90f3]
  - @tyto/core@0.51.1
  - @tyto/template-kit@0.12.6

## 0.6.0

### Minor Changes

- 1134d6e: The one-image table shares its width by reading every cell of a column: from the minimums, the
  leftover goes where it makes the table shortest, so one long cell in a row held tall by another
  column no longer takes the room. A `::tabela` line with no `|` that starts with `*` is a note,
  set small under the table; a `\` inside a row is a line break in that cell. A long
  parenthesised phrase may break, its last word never alone, and a dash stays with the word
  before it. A title the author broke into lines keeps exactly those
  lines, set smaller until each fits whole. In briefs, a lone `*` nothing on its line closes is a literal asterisk (ADR 0214),
  and a `Break` the author typed carries `typed: true`.

### Patch Changes

- Updated dependencies [a73ab4e]
- Updated dependencies [1134d6e]
  - @tyto/core@0.51.0
  - @tyto/template-kit@0.12.5

## 0.5.16

### Patch Changes

- Updated dependencies [fb4d987]
  - @tyto/core@0.50.0
  - @tyto/template-kit@0.12.4

## 0.5.15

### Patch Changes

- @tyto/template-kit@0.12.3

## 0.5.14

### Patch Changes

- Updated dependencies [560d12e]
- Updated dependencies [2d49c56]
  - @tyto/core@0.49.0
  - @tyto/template-kit@0.12.2

## 0.5.13

### Patch Changes

- Updated dependencies [7ddffdd]
- Updated dependencies [5bb9f91]
- Updated dependencies [4c9efc2]
- Updated dependencies [5def566]
  - @tyto/core@0.48.0
  - @tyto/template-kit@0.12.1

## 0.5.12

### Patch Changes

- Updated dependencies [d52b7b7]
- Updated dependencies [052247d]
  - @tyto/core@0.47.0
  - @tyto/template-kit@0.12.0

## 0.5.11

### Patch Changes

- Updated dependencies [a232861]
- Updated dependencies [54bbebf]
- Updated dependencies [85f200f]
- Updated dependencies [917636f]
  - @tyto/core@0.46.0
  - @tyto/template-kit@0.11.9

## 0.5.10

### Patch Changes

- Updated dependencies [46a013d]
- Updated dependencies [d700cf3]
- Updated dependencies [ef76145]
- Updated dependencies [1fae4a5]
- Updated dependencies [30bb335]
- Updated dependencies [399281d]
- Updated dependencies [ca2bc10]
  - @tyto/core@0.45.0
  - @tyto/template-kit@0.11.8

## 0.5.9

### Patch Changes

- Updated dependencies [9aa8b41]
- Updated dependencies [68a241a]
- Updated dependencies [fe22e84]
- Updated dependencies [0ed9eba]
  - @tyto/core@0.44.0
  - @tyto/template-kit@0.11.7

## 0.5.8

### Patch Changes

- Updated dependencies [4cae56d]
- Updated dependencies [94c593c]
  - @tyto/core@0.43.1
  - @tyto/template-kit@0.11.6

## 0.5.7

### Patch Changes

- @tyto/template-kit@0.11.5

## 0.5.6

### Patch Changes

- Updated dependencies [7345ac7]
  - @tyto/core@0.43.0
  - @tyto/template-kit@0.11.4

## 0.5.5

### Patch Changes

- Updated dependencies [cd096ab]
- Updated dependencies [ed7a364]
- Updated dependencies [4a91cef]
- Updated dependencies [4db076c]
- Updated dependencies [c0875cc]
- Updated dependencies [64a7b70]
  - @tyto/core@0.42.0
  - @tyto/template-kit@0.11.3

## 0.5.4

### Patch Changes

- Updated dependencies [6b193ff]
- Updated dependencies [fb529a1]
  - @tyto/core@0.41.0
  - @tyto/template-kit@0.11.2

## 0.5.3

### Patch Changes

- Updated dependencies [6f4c86e]
- Updated dependencies [f658466]
- Updated dependencies [4a7c29d]
- Updated dependencies [8d081ec]
  - @tyto/core@0.40.0
  - @tyto/template-kit@0.11.1

## 0.5.2

### Patch Changes

- Updated dependencies [d2ca2f1]
  - @tyto/core@0.39.0
  - @tyto/template-kit@0.11.0

## 0.5.1

### Patch Changes

- Updated dependencies [b5d2c00]
- Updated dependencies [2bc82e0]
  - @tyto/core@0.38.0
  - @tyto/template-kit@0.10.1

## 0.5.0

### Minor Changes

- 7c650a4: A template says which of its files is missing (TYTO-502). `@tyto/core` adds
  `W_TEMPLATE_FILE_MISSING` to the closed list a template may report, naming the artwork, the
  format, the template and the path it asked `context.files` for. `@tyto/house-style` gains
  `requiredImage`, and the product banner reports a format whose `assets/bg-<format>.png` is
  missing instead of drawing it on plain paper in silence. The report carries the path, so the
  plugin RPC protocol is 15.

### Patch Changes

- Updated dependencies [6d363a3]
- Updated dependencies [7c650a4]
- Updated dependencies [d1cd8ba]
  - @tyto/core@0.37.0
  - @tyto/template-kit@0.10.0

## 0.4.5

### Patch Changes

- Updated dependencies [28dc351]
- Updated dependencies [cd5d279]
  - @tyto/template-kit@0.9.0

## 0.4.4

### Patch Changes

- Updated dependencies [577052d]
  - @tyto/template-kit@0.8.0

## 0.4.3

### Patch Changes

- Updated dependencies [e94aa55]
  - @tyto/core@0.36.1
  - @tyto/template-kit@0.7.1

## 0.4.2

### Patch Changes

- Updated dependencies [9021b50]
- Updated dependencies [93fb9c9]
- Updated dependencies [147eafa]
- Updated dependencies [05c9f83]
  - @tyto/core@0.36.0
  - @tyto/template-kit@0.7.0

## 0.4.1

### Patch Changes

- fc3bee5: Tests and comments stop naming the production templates as if they were built in (TYTO-436): a test's template name is invented or one of the pack's test templates, and a comment about a template in its own repository names the repository. No behaviour changes.
- Updated dependencies [fc3bee5]
- Updated dependencies [04233fc]
- Updated dependencies [6881557]
- Updated dependencies [4168183]
  - @tyto/core@0.35.0
  - @tyto/template-kit@0.6.0

## 0.4.0

### Minor Changes

- a14d306: The azul brand's tokens, presets, logo header and signed footer are the subpath `@tyto/house-style/azul`, so `agenda-semana` and `aprovados` share one copy instead of each carrying its own.

### Patch Changes

- Updated dependencies [503f924]
- Updated dependencies [6d431f6]
- Updated dependencies [eca9871]
- Updated dependencies [b7c5136]
- Updated dependencies [b40dea8]
- Updated dependencies [0164874]
- Updated dependencies [cd14464]
  - @tyto/core@0.34.0
  - @tyto/template-kit@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [f612e26]
- Updated dependencies [096f80e]
  - @tyto/core@0.33.0
  - @tyto/template-kit@0.4.3

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
