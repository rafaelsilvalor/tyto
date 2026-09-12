# @tyto/template-lang

## 0.2.5

### Patch Changes

- Updated dependencies [f0d3d25]
  - @tyto/core@0.17.0

## 0.2.4

### Patch Changes

- Updated dependencies [a40f4d9]
  - @tyto/core@0.16.0

## 0.2.3

### Patch Changes

- Updated dependencies [04c076c]
  - @tyto/core@0.15.0

## 0.2.2

### Patch Changes

- Updated dependencies [15dfa8b]
  - @tyto/core@0.14.1

## 0.2.1

### Patch Changes

- Updated dependencies [2f72340]
  - @tyto/core@0.14.0

## 0.2.0

### Minor Changes

- a0a6155: TYTO-63 — a slot used only in the stylesheet is not unused.

  `compileTemplate` collected `renderedSlots` from the markup alone: `slot="…"` attributes and
  `{x}` spliced into a `src`. A template that decides its background with
  `@if slot(cor) is laranja { :root { --bg: #ff5900 } }` therefore reported `cor` as drawn by
  nothing, and a brief that set it got `W_UNUSED_SLOT` — the warning telling the author to
  delete the line that makes the template work.

  `renderedSlots` is now every slot the template **reads**, from four sources: a `slot`
  attribute, a slot spliced into a `src`, an at-rule condition (`@if … is <value>`,
  `@if … is empty`, `@each <slot>`), and the seeded variable `var(--slot-x)` however deeply a
  call nests it. The last one is past the letter of the card, which named the at-rules; it is
  the same bug wearing a different spelling, and the card's own reason for checking all three
  at-rules — _fixing one of three is a bug report waiting to be written again_ — applies to it
  unchanged.

  Deliberately still unused: a conditional block with nothing inside it. `@if slot(cor) is
laranja { }` reaches the cascade with no declarations and changes no output, so the slot in
  its prelude really is used by nothing.

  The warning is unchanged for a slot the template mentions nowhere, which is the half a fix
  like this can quietly trade away.

## 0.1.3

### Patch Changes

- Updated dependencies [e994ca9]
  - @tyto/core@0.13.0

## 0.1.2

### Patch Changes

- Updated dependencies [3a782b3]
  - @tyto/core@0.12.0

## 0.1.1

### Patch Changes

- Updated dependencies [192d674]
  - @tyto/core@0.11.0

## 0.1.0

### Minor Changes

- 7d0ebce: Parse `template.html` into a template function (TYTO-24)

  `@tyto/template-lang` now has its own Lezer grammar for the HTML-like markup and
  `compileTemplate(source, { manifest, assets })`, which returns the same `Template` a
  `template.ts` exports — so `compile` cannot tell the two authoring paths apart. The markup
  path additionally reports `renderedSlots`, which is what `resolve` needs to emit
  `W_UNUSED_SLOT`.

  Three contradictions inside `docs/template-authoring.md` are settled in the same pass:
  `content: slot(…)` is gone (`slot="x"` is the only way to draw a slot), `bg` and `format`
  join the frame's accepted attributes, and `@each <slot>` is documented as a scope rather
  than a loop.

  `@tyto/core` gains `E_UNSUPPORTED_TAG`, `E_UNSUPPORTED_ATTRIBUTE` and `E_TEMPLATE_MARKUP`,
  and exports `didYouMean`/`editDistance` — `resolve` and the template parser both need the
  same suggestion budget.

### Patch Changes

- Updated dependencies [7d0ebce]
  - @tyto/core@0.10.0
