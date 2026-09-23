# @tyto/template-kit

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
