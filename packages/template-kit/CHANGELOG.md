# @tyto/template-kit

## 0.6.1

### Patch Changes

- Updated dependencies [9021b50]
- Updated dependencies [93fb9c9]
- Updated dependencies [147eafa]
- Updated dependencies [bd56ec5]
  - @tyto/core@0.36.0
  - @tyto/template-lang@0.8.8
  - @tyto/export-html@0.7.9
  - @tyto/brief-lang@0.7.7

## 0.6.0

### Minor Changes

- 04233fc: TYTO-454: `@tyto/template-kit/testing` compiles a markup template (`template.html`) handed in as text, and `@tyto/template-lang` joins the published contract.

### Patch Changes

- fc3bee5: Tests and comments stop naming the production templates as if they were built in (TYTO-436): a test's template name is invented or one of the pack's test templates, and a comment about a template in its own repository names the repository. No behaviour changes.
- Updated dependencies [fc3bee5]
- Updated dependencies [04233fc]
- Updated dependencies [6881557]
- Updated dependencies [4168183]
  - @tyto/brief-lang@0.7.6
  - @tyto/core@0.35.0
  - @tyto/template-lang@0.8.7
  - @tyto/export-html@0.7.8

## 0.5.0

### Minor Changes

- eca9871: A template knows an image's width and height (TYTO-481, ADR 0158). `AssetRef` gains an optional `size: { w, h }`, read by the host off the header of a brief's image, a plugin-served image or a file in the template's own folder, and absent when no header parsed. `imageHeight(asset, width, fallback)` in `@tyto/template-kit` sizes a frame to it, so a frame follows the picture without a proportion written on the slide. **Breaking for plugins: the protocol is 13** (ADR 0149 point 4), because a guest on 12 refuses a ref that carries `size`.

### Patch Changes

- Updated dependencies [503f924]
- Updated dependencies [6d431f6]
- Updated dependencies [eca9871]
- Updated dependencies [b7c5136]
- Updated dependencies [993b9f6]
- Updated dependencies [b40dea8]
- Updated dependencies [0164874]
- Updated dependencies [cd14464]
- Updated dependencies [0d828d3]
  - @tyto/core@0.34.0
  - @tyto/export-html@0.7.7
  - @tyto/brief-lang@0.7.5

## 0.4.3

### Patch Changes

- Updated dependencies [f612e26]
- Updated dependencies [096f80e]
  - @tyto/core@0.33.0
  - @tyto/brief-lang@0.7.4
  - @tyto/export-html@0.7.6

## 0.4.2

### Patch Changes

- Updated dependencies [c590e01]
- Updated dependencies [e7588e9]
- Updated dependencies [4388575]
- Updated dependencies [e2b72a7]
  - @tyto/core@0.32.0
  - @tyto/brief-lang@0.7.3
  - @tyto/export-html@0.7.5

## 0.4.1

### Patch Changes

- Updated dependencies [a5912e7]
  - @tyto/core@0.31.0
  - @tyto/brief-lang@0.7.2
  - @tyto/export-html@0.7.4

## 0.4.0

### Minor Changes

- 46a0b89: TYTO-438: a template's manifest may declare what a configuration can change in it, under `values` — each a `color`, `length`, `number`, `face` or `image`, with its default and, for a length or a number, its limits (ADR 0153). `compile` hands the template the resolved values as `context.values`, the defaults overlaid by `CompileOptions.values`, and a supplied value the template did not declare, of the wrong kind or outside its limits is a warning at its range (`W_TEMPLATE_VALUE_UNKNOWN`, `W_TEMPLATE_VALUE_INVALID`) while the default stands. A template reads them with `numberValue`, `colorValue`, `faceValue` and `imageValue` from `@tyto/core/template`. `compileTemplate` in `@tyto/template-kit/testing` takes `values`. The house's one-image table reads its title gap, title and body size limits, optical drop and colours this way (`TABLE_VALUE_DEFAULTS`), and the built-in `tabela-roxo` declares them, drawing the same bytes when nothing is configured. Nothing reads a plugin file's configuration yet (TYTO-439), and values do not cross to a template in a plugin's process yet.

### Patch Changes

- Updated dependencies [7115286]
- Updated dependencies [46a0b89]
  - @tyto/core@0.30.0
  - @tyto/brief-lang@0.7.1
  - @tyto/export-html@0.7.3

## 0.3.0

### Minor Changes

- dfbadc7: Add `@tyto/template-kit/testing`: `compileTemplate` compiles a brief against one code template through the real brief parser, `resolve`, `compile` and the HTML exporter, and answers the scene and one HTML document per frame, so a template's own repository keeps its fixture + snapshot tests without a Tyto checkout (ADR 0152). The kit now depends on `@tyto/brief-lang` and `@tyto/export-html`, which are published with the contract.

## 0.2.2

### Patch Changes

- Updated dependencies [d4a6939]
- Updated dependencies [08b936d]
- Updated dependencies [7342c02]
- Updated dependencies [15997e9]
- Updated dependencies [93fcb8b]
- Updated dependencies [ea97dc3]
- Updated dependencies [c005b91]
- Updated dependencies [2495d0d]
- Updated dependencies [6abf89f]
- Updated dependencies [53e01c3]
- Updated dependencies [ae75027]
- Updated dependencies [fe85505]
- Updated dependencies [5a0c7c5]
- Updated dependencies [8e9c9c4]
- Updated dependencies [ab9512e]
- Updated dependencies [d3df40e]
- Updated dependencies [4aba89c]
- Updated dependencies [58f54d6]
- Updated dependencies [7a5f578]
- Updated dependencies [3355317]
- Updated dependencies [eb55249]
- Updated dependencies [a2b7fbd]
- Updated dependencies [532221f]
- Updated dependencies [5f98674]
- Updated dependencies [cfa70ff]
- Updated dependencies [bdab5da]
- Updated dependencies [eb0694a]
- Updated dependencies [dded20c]
- Updated dependencies [e4ce1e8]
- Updated dependencies [fdcfda9]
- Updated dependencies [4186112]
- Updated dependencies [3921252]
  - @tyto/core@0.29.0

## 0.2.1

### Patch Changes

- Updated dependencies [b20fe47]
- Updated dependencies [7dad141]
- Updated dependencies [4532332]
  - @tyto/core@0.28.0

## 0.2.0

### Minor Changes

- 3fab91f: TYTO-185: add the configurable components `pillTable` (a table read out of one slot) and `titleBlock` (a centred column of optional picture, words and rule), the `bandedPage` arrangement, and `mark`, `textBlock`, `grownTextBlock` and the brief-row readers (`lines`, `fields`, `rowGroups`). Add the `aprovados` template, the azul approved list, built only from those and the brand module. `agenda-semana` now composes the azul brand module (`templates/_azul/`) and renders the same pixels, except that the footer arrow is no longer drawn on the last slide: it announces a next slide, and the last one has none.
- e35546e: TYTO-201: an optional `selo` slot on `agenda-semana` (4.2.0), `aprovados` (4.2.0), `simulados-semana-ocre` and `simulados-semana-vinho` (1.1.0) — an art 1080 × 140 glued to the foot of the last grid slide, never on a story. With it the page above shrinks by 140: the middle centres above the seal and the footer stands on it. Write `selo: ./selo.png` in the frontmatter. The kit gains `sealed`, and `selo` joins the standard slot vocabulary as a reserved `image` name.
- b02313b: TYTO-200: three new templates, `simulados-semana-roxo`, `simulados-semana-ocre` and `simulados-semana-vinho` — the weekly mock-exam agenda of roxo (stories only), ocre and vinho, one composition in three accents. Each `::lamina` is one slide: `Domingo 26/10 | Aplicação às 08h30 & correção às 14h` starts a day and every line with no `|` under it is one of its exams. The title is on every slide; the call to comment is on the last grid only, in the brief's optional `::chamada` or in the house's line. Rows are 700 px wide, or as wide as the slide's longest exam up to 856; the owl and the sign-off stand on a 112 px gutter. `pillTable` gains a group `caption`, the band under a heading drawn from the heading line's second field.
- 525639b: TYTO-202: a template reports warnings beside its frame (ADR 0058). `TemplateContext` gains `report`, which takes one of a closed list of codes — the first is `W_TEMPLATE_OVERFLOW` — and `compile` writes the catalog's diagnostic with the artwork, the format and the range of the directive the artwork came from. An installed code template's reports cross back from its plugin's process beside the frame, as `ok({ frame, reports })`, checked against that list. `reportOverflow` in `@tyto/template-kit` reports content that runs past the page, and the weekly mock-exam agendas use it: a slide that runs off the grid now renders with a warning instead of being cut in silence. A context built by hand passes `reportNothing`.

### Patch Changes

- 7950dc3: TYTO-223: a plugin contributes a brand kit — a logo mark and a signature per brand id — through
  the new `brand-kit` extension point, and a template reads the kit of its own manifest's `brand`
  from `context.brand` (ADR 0063). `TemplateContext` gains the required `brand` field; a context
  built by hand passes `noBrandKit`. `CompileOptions` and `JobPorts` take `brandKits`, which
  `PluginRegistry.brandKitsByBrand()` merges: the plugin registered first keeps a brand, and
  `W_BRAND_KIT_SHADOWED` names the one it hid. The kit is data and crosses to an installed code
  template with the call, so the isolation protocol is now version 3. `Mark` moves to
  `@tyto/core` as `MarkShape`; `@tyto/template-kit` still exports it as `Mark`.
- Updated dependencies [0937670]
- Updated dependencies [37fd201]
- Updated dependencies [7950dc3]
- Updated dependencies [8300c78]
- Updated dependencies [bf7c79a]
- Updated dependencies [8ca8eed]
- Updated dependencies [a84b756]
- Updated dependencies [a33a192]
- Updated dependencies [733f779]
- Updated dependencies [d4aac5b]
- Updated dependencies [94fdee3]
- Updated dependencies [eaf6ece]
- Updated dependencies [cd25d2d]
- Updated dependencies [5c0611f]
- Updated dependencies [82927c8]
- Updated dependencies [a69f493]
- Updated dependencies [64c75bb]
- Updated dependencies [091e2a2]
- Updated dependencies [e35546e]
- Updated dependencies [7659e7e]
- Updated dependencies [525639b]
  - @tyto/core@0.27.0

## 0.1.4

### Patch Changes

- Updated dependencies [17ad960]
  - @tyto/core@0.26.0

## 0.1.3

### Patch Changes

- Updated dependencies [b587f0d]
  - @tyto/core@0.25.0

## 0.1.2

### Patch Changes

- Updated dependencies [8b24969]
  - @tyto/core@0.24.0

## 0.1.1

### Patch Changes

- Updated dependencies [80a03a8]
  - @tyto/core@0.23.0

## 0.1.0

### Minor Changes

- 1e69d54: TYTO-165 — the first production templates are being written in TypeScript to learn the
  ergonomics, and the SDK that route uses is finished while saying nothing about how to organise
  what sits on top of it. This is the convention, plus the one layer of it that is the same
  whatever is being drawn.

  **What was missing.** `@tyto/core/template` hands over six node builders and the values that
  feed them. Every coordinate above that is the author's, so two templates written a week apart
  would invent two arrangements and share neither. `docs/template-authoring.md` documents the
  route and stops at the SDK.

  **`@tyto/template-kit` is the arrangement layer**: `stack`, `row`, `inset` and `at`, resolving
  to the absolute coordinates the IR wants before it sees anything. No new IR field, no exporter
  change, nothing in `compile` — a stack returns the same `group` a hand-placed template produces.

  **A block states its own size, and that is the finding rather than a design taste.** Nothing
  downstream can work one out. A `group` in the IR is a transform and a list with no box at all,
  and a text node's `box` leaves both dimensions optional, because an absent one means "as large
  as the content needs" — a size only `layoutText` learns, and it runs after `build` has already
  returned. So the height a stack needs in order to place the next child does not exist anywhere
  a stack could read it. Putting it in the type is what stops a layout silently overlapping, and
  it puts TYTO-162's gap where an author meets it on the first template instead of the tenth.

  `sized()` therefore accepts a rect, an image or a vector and **not** a text or a group: neither
  can answer, and an overload that guessed would be the overlap this module exists to prevent.

  Placement adds to the coordinate a node already carries rather than replacing it, so a node
  nudged by hand keeps its nudge wherever it is put.

  **Measured: 13 tests, and all three promises were perturbed to prove the suite protects them.**
  Charging the gap after the last child instead of between neighbours reddened **3 of 13**;
  replacing a coordinate instead of adding to it reddened **1 of 13**; making the cross-axis
  alignment always return zero reddened **2 of 13**. The file was restored byte for byte after
  each and the suite is green.

  **`docs/template-conventions.md` is the written half**, linked from `docs/template-authoring.md`.
  It settles what that document left open:

  - **The manifest stays YAML and the module never imports it.** The registry exists to answer
    what templates exist and what each declares _without importing a line of template code_, so a
    manifest written in TypeScript would make opening a picker execute every template on the
    machine. The module exports its `build`; whoever loads it pairs the two. That also keeps a
    build step out of a template folder, which is what ADR 0020 decided a pack must not need.
  - **Three layers, and only one of them ships here.** Tokens and parts belong to a brand and live
    beside the templates that share them; a kit that shipped a palette would be deciding somebody
    else's brand.
  - **Reuse across templates is an import.** ADR 0022 refused a component library because a
    component's classes land in one flat namespace and sharing would force CSS scoping. There is
    no stylesheet on this route, so that objection does not apply — and the ADR's decision for
    markup is untouched.
  - **Geometry in, colour out**, with a mechanical test: if the source SVG has a `<style>` block,
    its markup does not travel. Exported files name their classes from `.cls-1` every time, so two
    in one artwork repaint each other (TYTO-168).

  **What this does not do.** A box still cannot grow with its text, and no helper here pretends
  otherwise. That needs a template to be able to measure, which TYTO-162 is. Until then every
  height a block states is a height somebody chose.

### Patch Changes

- Updated dependencies [353c83d]
  - @tyto/core@0.22.2
