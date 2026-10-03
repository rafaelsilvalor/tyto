# @tyto/template-lang

## 0.7.0

### Minor Changes

- 272a4ce: `tyto template check` warns with `W_SLOT_VOCABULARY` when a manifest names a slot against the
  standard vocabulary in `docs/slot-vocabulary.md`: a known synonym (`emblema` for `imagem`,
  `slide` for `lamina`, `cor` for `tom`…), a reserved name with the wrong shape, or a repeatable
  slot not named `lamina`. It is a warning and never fatal, and a name the document does not list
  is never flagged. `checkSlotVocabulary` is exported from `@tyto/core`.

  The template scaffold (`tyto template new`, the desktop's New template, `tyto plugin new`)
  names its look-variant slot `tom` instead of `cor`, so a new template starts without the
  warning. A scaffolded brief writes `tom: laranja`.

- b054a34: TYTO-44 — the desktop app has a template mode. _File ▸ Edit template…_ opens a markup template
  folder with `manifest.yaml` and `template.html` in tabs of their own, one of the folder's
  `examples/*.brief` as the sample, and every format the manifest declares drawn side by side
  from the unsaved buffers. Saving writes both files and reads the template folders again, and
  every open brief is compiled again; a manifest that does not parse is not written, and the
  diagnostic that stopped it is shown. A folder whose layout is a `template.ts` is refused with a
  sentence saying why (ADR 0007). _File ▸ New template…_ writes the same scaffold as
  `tyto template new`, into the template folder in force.

  The scaffold moved to `@tyto/template-lang` (`scaffoldTemplate`, `isTemplateName`) so both hosts
  write one text. It now also writes `examples/<name>.brief`, and its title uses "Source Sans 3"
  instead of "Inter": no install of Tyto has Inter, so every scaffolded template failed its first
  render with `E_EXPORT_FONT_UNRESOLVED`. `@tyto/editor` takes `language: 'plain'` for a buffer
  with no grammar.

  A quit that arrives while the window is still starting now quits (ADR 0039). The page tells main
  it can hear the quit question (`app:exit-listening`) before main asks it anything; before that,
  the push was dropped and the app stayed open with nobody left to ask.

### Patch Changes

- cae8d1d: TYTO-214: a code template reads the files in its own folder through `context.files.image(path)`
  and `context.files.svg(path)` (ADR 0062). `TemplateContext` gains the required `files` field, and
  a context built by hand passes `noFiles`. `bundledTemplateSource` takes an optional
  `readFiles(directory)`; without it, a bundled template is handed no files, as before. An
  installed plugin's code template is handed `noFiles`.
- 2aa7d06: TYTO-194: formats are named by piece kind, and each format says which kind it is (`docs/format-kinds.md`, ADR 0051).

  **Briefs must be edited.** The built-in pack's `retrato` is now `grid`, and `feed` is now `grid-1x1`; `story` is unchanged. All four built-in templates take a major version (`agenda-semana` 4.0.0, `aprovados` 4.0.0, `carrossel-lista` 3.0.0, `promo-curso` 3.0.0). A brief that still writes the old ids is told the format is not defined.

  ```
  before                          after
  formats: [retrato]              formats: [grid]
  formats: [feed, story]          formats: [grid-1x1, story]
  lamina-1-retrato.png            lamina-1-grid.png
  artwork-1-feed.png              artwork-1-grid-1x1.png
  ```

  The pixels are unchanged: every built-in example renders identical to the previous ids, 14 of 14 files, and only the file names change.

  `formats.yaml` entries gain an optional `kind` (`grid`, `story`, `banner`, `capa-ebook`, `thumbnail`), and `@tyto/core` exports `pieceKinds`, which derives what a template makes from its formats and whether it repeats: a repeating grid is a `carrossel`, a repeating story is `stories`. `tyto template new` and `tyto plugin new` scaffold `grid` by default. An installed plugin whose templates declare `feed` needs a project `formats.yaml` that defines it, or its own ids moved to the new names.

- 8e05004: TYTO-202: a template reports warnings beside its frame (ADR 0058). `TemplateContext` gains `report`, which takes one of a closed list of codes — the first is `W_TEMPLATE_OVERFLOW` — and `compile` writes the catalog's diagnostic with the artwork, the format and the range of the directive the artwork came from. An installed code template's reports cross back from its plugin's process beside the frame, as `ok({ frame, reports })`, checked against that list. `reportOverflow` in `@tyto/template-kit` reports content that runs past the page, and the weekly mock-exam agendas use it: a slide that runs off the grid now renders with a warning instead of being cut in silence. A context built by hand passes `reportNothing`.
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

## 0.6.6

### Patch Changes

- 17ad960: TYTO-162: a template can ask how big a text node will be before it places it (ADR 0038).

  `TemplateContext.measure(node)` returns the `TextMeasurement` — lines, width, height — that
  `compile` will lay the node out at, from the same `measureText` over the same faces, or
  `undefined` when nothing can measure. `measureNothing` is the answer for a context with no faces.
  `measureText` accepts a node without an id (`MeasurableText`), so a template measures the draft it
  is about to place.

  **Breaking for anyone who builds a `TemplateContext` by hand**: `measure` is now required.

- Updated dependencies [17ad960]
  - @tyto/core@0.26.0

## 0.6.5

### Patch Changes

- Updated dependencies [b587f0d]
  - @tyto/core@0.25.0

## 0.6.4

### Patch Changes

- Updated dependencies [8b24969]
  - @tyto/core@0.24.0

## 0.6.3

### Patch Changes

- Updated dependencies [80a03a8]
  - @tyto/core@0.23.0

## 0.6.2

### Patch Changes

- Updated dependencies [353c83d]
  - @tyto/core@0.22.2

## 0.6.1

### Patch Changes

- Updated dependencies [91b6bc5]
  - @tyto/core@0.22.1

## 0.6.0

### Minor Changes

- 5309eb2: TYTO-107 — a stage may produce a value and still report errors

  A brief with one error anywhere used to render nothing. It now renders the slots that are
  fine and reports the one that is not, because severity and fatality are two questions and
  they were one field (ADR 0025).

  **`Ok<T>.warnings` is `Ok<T>.diagnostics`.** It no longer holds only warnings: a non-fatal
  error rides the ok branch beside the part of the value that survived. A code declares
  `fatal` beside `severity` in the catalogue, `fromPartial(value, items)` is what a stage with
  something partial to hand back returns, and `hasFatal` is the test. `fromDiagnostics` is
  unchanged and is still right for a stage with nothing partial to offer. `withWarnings` is
  `withDiagnostics`.

  **Severity still decides the exit code.** A partly rendered brief is `hasErrors` and fails a
  build; what changed is that it also writes its artifacts, so `result.json` is
  `status: error` with a non-empty `artifacts` — the state `docs/render-contract.md` now calls
  _rendered, with errors_.

  **`E_SYNTAX` split three ways**, because fatality is a property of the code: `E_SYNTAX` is a
  line of the brief body and is not fatal, `E_FRONTMATTER_SYNTAX` is the block that names the
  template and is, and `E_TEMPLATE_SYNTAX` is a `template.html` and is. `docs/diagnostic-codes.md`
  publishes the whole list with the reason for each entry.

  **A failed frame no longer costs the report.** `runJob` returns its `JobReport` with the
  errors riding along, so the eleven frames of twelve that rendered are listed rather than
  dropped — `result.json` used to say `artifacts: []` over a folder the same run had written
  nine files into.

  `E_MISSING_REQUIRED_SLOT` and the unresolved-export codes stay fatal on purpose: each would
  leave a hole in the artwork that nothing in the artwork names, and art that looks finished
  with a slot silently empty is the failure this card had to avoid.

### Patch Changes

- Updated dependencies [5309eb2]
  - @tyto/core@0.22.0

## 0.5.0

### Minor Changes

- 4fad5b9: Quick fixes reach the three cases they were missing (TYTO-92).

  **An adjustment that carries a value is fixable.** `E_BAD_ADJUSTMENT` is ranged over
  `name: value` for an enum, and the whole-range guard refused it rather than rewrite the
  author's value. The editor now cuts at the first colon — exact, not approximate, because
  the grammar forbids a space in front of one — and replaces only the name: `{tomm: claro}`
  becomes `{tom: claro}`.

  **A property the alias table knows gets a button, not only a message.** `background` is not
  a typo of anything, so no edit distance would ever find `fill`.
  `@tyto/template-lang` now exports `propertyAlias`, `tagAlias` and `attributeAlias`, each
  filtered to the entries that name exactly one accepted thing — the multi-word ones ("x, y
  and rotation") stay in the message, which is where a sentence belongs.

  **An attribute on the wrong tag gets one too.** Which attributes are legal is a question
  only the tag answers, and `E_UNSUPPORTED_ATTRIBUTE` does not carry the tag as a field. The
  editor climbs from the diagnostic's range to the enclosing `Element` in the tree it already
  has, rather than the diagnostic growing a field for one consumer. `object-fit` is offered as
  `fit` on an `<image>` and refused on a `<rect>`, which does not take it.

  Also: the editor's test run no longer prints a jsdom `TypeError` from CodeMirror's measuring
  pass on every test that draws a marker.

## 0.4.0

### Minor Changes

- 2deabb8: Component parameters: a `<use>` decides which slot its component draws (TYTO-75).

  `<define name="linha" params="texto">` declares a parameter, `slot="texto"` in the body names
  it, and `<use component="linha" texto="titulo">` binds it. Every attribute on a `<use>` other
  than `component` and `class` is a binding. Without this a component repeated shape; with it,
  content.

  The substitution runs on the component's children **before** they are expanded, and therefore
  before anything validates them. Nothing downstream knows a parameter existed: `slot="rodape"`
  written by hand and `texto="rodape"` bound to a component are the same undeclared slot with
  the same `E_TEMPLATE_MARKUP`, the type check still refuses a `<text>` bound to an image slot,
  and `renderedSlots` counts a slot reached only through a parameter, so `W_UNUSED_SLOT` does
  not fire on it. The range on such a refusal is the **binding's**: the `<define>` is correct and
  the `<use>` is not.

  Three places in a body name a slot and a parameter is substituted into all three — `slot="…"`,
  a `{…}` spliced into a `src`, and a nested `<use>`'s own binding, which is how a parameter is
  handed one component further down.

  Refused with a range: an unknown parameter name and a parameter nothing binds (each with a
  suggestion, and a typo produces one sentence rather than both), a parameter bound to nothing,
  a parameter called `component` or `class`, a parameter declared twice, a parameter spelled the
  way no slot could be, and a parameter carrying the name of a slot the manifest declares —
  which would make `slot="titulo"` in that body mean the parameter, with no spelling left for
  the slot.

  A `<use>` whose parameters are not all bound is not expanded, so an unbound `slot="texto"` is
  never also reported as an undeclared slot.

## 0.3.0

### Minor Changes

- 8e6c2ef: Reusable components in the template markup: `<define>` and `<use>` (TYTO-74).

  A block written once and drawn where it is named. `<define name="chip">` sits at the top
  level beside the frames, in any order; `<use component="chip">` goes wherever a node may
  appear, including inside another `<define>`. Expansion happens on the parsed document
  before `collectFrames` reads it, so nothing downstream learns the two tags exist: the
  document that leaves `expandComponents` holds the tags the author would have typed by hand,
  and the IR receives a `group` indistinguishable from a hand-written one.

  The classes on a `<use>` land on **every** node of the expansion, however deep, which is how
  an instance is overridden in a language with no descendant combinator and no specificity —
  `.chip-bar.second` reads a class written three levels above it. It is the shape a flag
  adjustment already has over an artwork (`.item.destaque`). ADR 0022 records why, and why the
  combinator ADR 0017 closed stays closed.

  A `<define>` writes no `id`: an id is unique in a frame and a `<use>` may be written twice.
  A circular `<use>`, an unknown component name (with a suggestion), a second `<define>` under
  one name, an empty `<define>`, a `<define>` written anywhere but the top level and a `<use>`
  written at it are each refused with a range. A component nothing draws yet is checked
  anyway, because `tyto template check` is run while a template is being written.

  Diagnostics are now reported once per `(code, message, range)`. A component drawn three
  times is checked three times and the same sentence at the same place is one mistake, on one
  line of the `<define>`.

  No built-in template changes. Across `promo-curso` and `carrossel-lista` there are 10
  drawable tags and 0 repeated subtrees; the duplication those two files contain is in the
  stylesheet, which a component does not touch.

## 0.2.10

### Patch Changes

- Updated dependencies [ca8f122]
- Updated dependencies [2cea94a]
  - @tyto/core@0.21.1

## 0.2.9

### Patch Changes

- Updated dependencies [eb57af0]
  - @tyto/core@0.21.0

## 0.2.8

### Patch Changes

- Updated dependencies [9b3ecd4]
  - @tyto/core@0.20.0

## 0.2.7

### Patch Changes

- Updated dependencies [9b44b9d]
  - @tyto/core@0.19.0

## 0.2.6

### Patch Changes

- Updated dependencies [4519c36]
  - @tyto/core@0.18.0

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
