# @tyto/template-kit

## 0.2.0

### Minor Changes

- 2232f11: TYTO-185: add the configurable components `pillTable` (a table read out of one slot) and `titleBlock` (a centred column of optional picture, words and rule), the `bandedPage` arrangement, and `mark`, `textBlock`, `grownTextBlock` and the brief-row readers (`lines`, `fields`, `rowGroups`). Add the `aprovados` template, the Saúde approved list, built only from those and the brand module. `agenda-semana` now composes the Saúde brand module (`templates/_estrategia-saude/`) and renders the same pixels, except that the footer arrow is no longer drawn on the last slide: it announces a next slide, and the last one has none.
- ac09068: TYTO-201: an optional `selo` slot on `agenda-semana` (4.2.0), `aprovados` (4.2.0), `simulados-semana-ecj` and `simulados-semana-oab` (1.1.0) — an art 1080 × 140 glued to the foot of the last grid slide, never on a story. With it the page above shrinks by 140: the middle centres above the seal and the footer stands on it. Write `selo: ./selo.png` in the frontmatter. The kit gains `sealed`, and `selo` joins the standard slot vocabulary as a reserved `image` name.
- 1208948: TYTO-200: three new templates, `simulados-semana-ec`, `simulados-semana-ecj` and `simulados-semana-oab` — the weekly mock-exam agenda of Estratégia Concursos (stories only), Carreira Jurídica and OAB, one composition in three accents. Each `::lamina` is one slide: `Domingo 26/10 | Aplicação às 08h30 & correção às 14h` starts a day and every line with no `|` under it is one of its exams. The title is on every slide; the call to comment is on the last grid only, in the brief's optional `::chamada` or in the house's line. Rows are 700 px wide, or as wide as the slide's longest exam up to 856; the owl and the sign-off stand on a 112 px gutter. `pillTable` gains a group `caption`, the band under a heading drawn from the heading line's second field.
- 8e05004: TYTO-202: a template reports warnings beside its frame (ADR 0058). `TemplateContext` gains `report`, which takes one of a closed list of codes — the first is `W_TEMPLATE_OVERFLOW` — and `compile` writes the catalog's diagnostic with the artwork, the format and the range of the directive the artwork came from. An installed code template's reports cross back from its plugin's process beside the frame, as `ok({ frame, reports })`, checked against that list. `reportOverflow` in `@tyto/template-kit` reports content that runs past the page, and the weekly mock-exam agendas use it: a slide that runs off the grid now renders with a warning instead of being cut in silence. A context built by hand passes `reportNothing`.

### Patch Changes

- Updated dependencies [c0eb5b7]
- Updated dependencies [cae8d1d]
- Updated dependencies [416345a]
- Updated dependencies [8b94c6c]
- Updated dependencies [8196946]
- Updated dependencies [2aa7d06]
- Updated dependencies [0c01004]
- Updated dependencies [8f7ee31]
- Updated dependencies [11fb507]
- Updated dependencies [cc4ca1d]
- Updated dependencies [b7a02ce]
- Updated dependencies [2983c3e]
- Updated dependencies [e3b814b]
- Updated dependencies [0891ff7]
- Updated dependencies [b32d72e]
- Updated dependencies [ac09068]
- Updated dependencies [272a4ce]
- Updated dependencies [8e05004]
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
