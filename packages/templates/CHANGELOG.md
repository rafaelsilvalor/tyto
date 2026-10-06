# @tyto/templates

## 1.0.0

### Major Changes

- bacf1c5: TYTO-190: `aprovados` 3.0.0 runs across several slides. Each `::lamina` is one slide and holds its specialties and `rank | name` rows; the title block (imagem, chamada, subtitulo, titulo) is drawn on the first slide only, and the arrow on every slide but the last. **Briefs must be edited**: `::lista` becomes `::lamina`, and an old `::lista` is reported as `E_UNKNOWN_SLOT`. One `::lamina` with the old list renders the same pixels as 2.0.0.
- 733f779: TYTO-194: formats are named by piece kind, and each format says which kind it is (`docs/format-kinds.md`, ADR 0051).

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

### Minor Changes

- 35c8732: TYTO-210: a new template, `banner-roxo`, and three new formats in the built-in pack: `banner` (1200 × 628), `banner-1x1` (600 × 600) and `banner-345x146` (345 × 146), all of kind `banner`. The template draws roxo's product banner: write only `::titulo`, for example `Prefeitura Municipal de São Bento do Vale Alto **(VA)**`, and each format draws its own fixed background from the template's folder with the text centred where the reference draws it. The template chooses the line breaks: the largest size that fits, balanced lines, a group in parentheses never split or alone on a line, and no line ending on `de`, `do` or `e` when a better break exists. A text too long for the smallest size is drawn at that size and reported as `W_TEMPLATE_OVERFLOW`. `tabela-roxo` now also keeps a multi-word qualifier in parentheses whole after a number.
- 37fd201: TYTO-230: a brand kit's logo may be toned layers — `{ box, layers: [{ tone, d, fillRule }] }`, with `tone` `primary` or `secondary` and still no colour — as well as one `MarkShape`, which keeps working as all `primary`; and a kit may carry a `wordmark` under the same rules (ADR 0066). A mark's paths together are bounded by `MARK_PATH_LIMIT`, and a toned mark has at most `MARK_LAYER_LIMIT` (16) layers. The isolation protocol is now version 4. The built-in templates map each tone to a colour of their own, and `banner-roxo` draws the kit's wordmark in its square format; without a kit their output is unchanged.
- 3574889: TYTO-225: the built-in templates no longer carry a brand's logo or signature. Each draws its brand kit's (ADR 0063) and, where no kit supplies one, a placeholder in the same box and style: an invented rounded mark for the logo and `@assinatura` for the signature (ADR 0065). The three `banner-roxo` backgrounds lose the logo painted into them, and the banner draws the kit's logo, or the placeholder, where it stood. The drawn nodes are named `logo` and `signature`.
- bf7c79a: TYTO-224: the built-in brands and templates are renamed by colour. The brand ids are `azul`, `roxo`, `ocre` and `vinho`; the templates are `simulados-semana-roxo`, `simulados-semana-ocre`, `simulados-semana-vinho`, `tabela-roxo` and `banner-roxo`, and `agenda-semana` and `aprovados` keep their names. A brief naming a template by its previous name must use the new one. Every template draws the same bytes as before for the same brief; the examples of `aprovados`, `banner-roxo`, `simulados-semana-vinho` and `tabela-roxo` now carry invented copy of the same shape. `@tyto/core`'s message for a malformed `brand` gives `azul` as its example.
- eaf6ece: TYTO-195: a template's manifest can name its brand (`brand: azul`), lower case letters, digits and single hyphens (ADR 0052). It is optional, so existing manifests still load. The built-in templates name theirs: `agenda-semana` and `aprovados` are `azul`, `carrossel-lista` and `promo-curso` are `tyto-demo`. No brief changes and no render changes.
- 3fab91f: TYTO-185: add the configurable components `pillTable` (a table read out of one slot) and `titleBlock` (a centred column of optional picture, words and rule), the `bandedPage` arrangement, and `mark`, `textBlock`, `grownTextBlock` and the brief-row readers (`lines`, `fields`, `rowGroups`). Add the `aprovados` template, the azul approved list, built only from those and the brand module. `agenda-semana` now composes the azul brand module (`templates/_azul/`) and renders the same pixels, except that the footer arrow is no longer drawn on the last slide: it announces a next slide, and the last one has none.
- e35546e: TYTO-201: an optional `selo` slot on `agenda-semana` (4.2.0), `aprovados` (4.2.0), `simulados-semana-ocre` and `simulados-semana-vinho` (1.1.0) — an art 1080 × 140 glued to the foot of the last grid slide, never on a story. With it the page above shrinks by 140: the middle centres above the seal and the footer stands on it. Write `selo: ./selo.png` in the frontmatter. The kit gains `sealed`, and `selo` joins the standard slot vocabulary as a reserved `image` name.
- b02313b: TYTO-200: three new templates, `simulados-semana-roxo`, `simulados-semana-ocre` and `simulados-semana-vinho` — the weekly mock-exam agenda of roxo (stories only), ocre and vinho, one composition in three accents. Each `::lamina` is one slide: `Domingo 26/10 | Aplicação às 08h30 & correção às 14h` starts a day and every line with no `|` under it is one of its exams. The title is on every slide; the call to comment is on the last grid only, in the brief's optional `::chamada` or in the house's line. Rows are 700 px wide, or as wide as the slide's longest exam up to 856; the owl and the sign-off stand on a 112 px gutter. `pillTable` gains a group `caption`, the band under a heading drawn from the heading line's second field.
- 441b545: TYTO-157: the built-in templates use the standard slot vocabulary (`docs/slot-vocabulary.md`). **Briefs written against the previous versions must be edited**: `promo-curso` 2.0.0 renames `cor` to `tom`; `carrossel-lista` 2.0.0 renames `item` to `lamina`; `agenda-semana` 3.0.0 renames `ilustracao` to `imagem` and `slide` to `lamina`; `aprovados` 2.0.0 renames `emblema` to `imagem`. An old name is reported as `E_UNKNOWN_SLOT` on its line. The pixels are unchanged; exported files and SVG element ids of the two carousel templates are now named `lamina-N` instead of `item-N` and `slide-N`.
- 98d432e: TYTO-218: a new template, `tabela-roxo`. It draws roxo's title over a whole table in one 1080 × 1350 image. Write `::titulo`, then `::tabela`: the first line is the header (`Concurso | Banca | Vagas | Salário`) and fixes the column count, each later `a | b | c` line is a row, and a line with no `|` is a band across the table. The template measures to decide column widths, line breaks, the body size and the title size. It never splits a value such as `R$ 33.820,39`, breaks a range `R$ X a R$ Y` between its two values, and reports `W_TEMPLATE_OVERFLOW` when the table does not fit even at its 16 px floor. The accent is roxo's registered `#5900a6`, the agenda's.
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
- 8ff5137: TYTO-237: the `agenda-semana` and `simulados-semana-ocre` examples carry invented copy of the same shape in their last lines that still quoted real names. Every template draws the same bytes as before for the same brief; only those two examples' renders change.
- 861bf8b: `simulados-semana-roxo` 1.0.1, `-ocre` and `-vinho` 1.1.1: the owl and the sign-off now start on the middle's left edge, with the title, the days, the band and the call to comment, instead of on the 112 px gutter. No brief changes.
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
- Updated dependencies [3fab91f]
- Updated dependencies [cd25d2d]
- Updated dependencies [5c0611f]
- Updated dependencies [82927c8]
- Updated dependencies [a69f493]
- Updated dependencies [64c75bb]
- Updated dependencies [091e2a2]
- Updated dependencies [e35546e]
- Updated dependencies [b02313b]
- Updated dependencies [7659e7e]
- Updated dependencies [525639b]
  - @tyto/core@0.27.0
  - @tyto/template-kit@0.2.0

## 0.6.0

### Minor Changes

- b749c43: TYTO-184: in `agenda-semana`, a session title or professor too long for one line wraps onto the next
  and the pill grows to hold it, as the published artwork does, instead of shrinking. The date pill
  grows with it, and the sessions below move down. A title that fits keeps the published 86 px pill.
  Where nothing can measure the text, the pill keeps its single-line height and a long line shrinks,
  as before.

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
  - @tyto/template-kit@0.1.4

## 0.5.0

### Minor Changes

- 8092940: TYTO-173: `agenda-semana` puts several disciplines on one slide, as the published carousel does.

  **Breaking for a brief written against 1.0.0 of the template.** The repeatable slot is now `slide`,
  not `disciplina`: one occurrence is one slide, and inside it a line with no `|` starts a discipline
  and every `date | title | professor` line under it is one of its sessions. The template renders in
  a new `retrato` format (1080×1350, Instagram's 4:5 post), added to the pack's `formats.yaml`; it
  no longer declares `feed` or `story`.

  The slide is three bands: the owl pinned to the top, the handle and arrow to the bottom, the cover
  under the owl on the first slide only, and the disciplines centred in what is left. The date pill
  sits on the left end of the grey pill instead of beside it, sessions are 4 px apart, and a title
  too long for its pill is drawn smaller (`overflow: 'shrink'`) instead of reported. The owl and the
  arrow are the brand files' geometry, with the colour still the template's.

  **`tyto render` now measures text.** The CLI hands `compile` the bundled faces, as the desktop
  preview already did. Before this, a `shrink` reached `export-html` as `W_EXPORT_APPROXIMATED`
  and was clipped, line breaks were left to the exporter, and `W_TEXT_OVERFLOW` was never raised.

- b587f0d: TYTO-182: a face can come from the machine that renders, and a missing one is drawn and reported
  (ADR 0037).

  `FontRef.source` gains `'system'`, asked for with `systemFont(family)`. `@tyto/fonts`'
  `createFontLibrary({ describe: describeFace })` reads the platform's font folders, matches a file
  on its own tables, and answers the exporters and measurement from the same file. Where the machine
  lacks the face it draws the bundled Source Sans 3 at the nearest weight and raises
  `W_FONT_SUBSTITUTED`, in `result.json` and in the desktop preview.

  `agenda-semana` now draws in CircularXX: Black for the cover, Medium for the discipline, date and
  session title, Light for the professor and the handle.

  `JobPorts.loadResources` may answer with diagnostics. `sceneResources` no longer lists a declared
  font at 400 when its runs already draw it. The desktop export now measures text, as the CLI and
  the preview do.

### Patch Changes

- Updated dependencies [b587f0d]
  - @tyto/core@0.25.0
  - @tyto/template-kit@0.1.3

## 0.4.1

### Patch Changes

- Updated dependencies [8b24969]
  - @tyto/core@0.24.0
  - @tyto/template-kit@0.1.2

## 0.4.0

### Minor Changes

- d3587dd: TYTO-167 — the first production template written in TypeScript, and the first entry in
  `BUILT_IN_TEMPLATE_BUILDS`, which TYTO-166 shipped empty. `agenda-semana` draws the azul
  week's agenda as a carousel: a cover on the first slide, one discipline per slide, and as many
  session rows as the brief wrote.

  **It was picked as a hard case.** 27 drawable nodes in a slide against an 8-tag high-water mark
  in the markup pack, and 20 of the 27 are four copies of one five-node row. Three open cards are
  routed around rather than closed: stacking is `stack()` and not TYTO-161, repetition is `.map()`
  and not TYTO-163, and "first slide only" is `context.artwork.index === 0` and not TYTO-164. All
  three stay real for the markup route.

  **The three layers held, and a `Block` bought more than stacking.** `template.ts` is composition
  and nothing else; the numbers are in `tokens.ts` and the shapes in `parts.ts`. The unplanned win
  is that a block carrying its own height lets the template _place itself_: the body is centred in
  the room between the owl and the handle, computed from the stack's measured height, so a slide
  with one session and a slide with four are both balanced. A markup group has no size to read
  back, so that layout is not available on the other route at all.

  **Both numbers come from the brief, and one of them costs a convention.** A manifest may declare
  one repeatable slot and its occurrences become artworks, so the repeat is spent on "a slide per
  discipline" and the rows inside a slide have nothing left to repeat with. The sessions are read
  out of the occurrence's own lines instead — first line the discipline, each line after it
  `date | title | professor`. It works today and it asks a brief's author to learn a separator the
  language does not enforce; the split refuses to cut inside `**bold**` or a mark, where a bar is
  somebody meaning something else.

  **The wall is made to announce itself.** The grey pill's height is fixed, because a template
  cannot measure text: `build` decides every coordinate before `layoutText` runs. The choice this
  template makes is to state the text box's `h` as well as its `w`, so a title too long for the
  pill is a `W_TEXT_OVERFLOW` naming the `disciplina` directive — instead of an absent `h`, which
  means "as large as the content needs" and wraps the title silently out of the shape around it.
  TYTO-162 removes the wall; until then the only fix is a shorter title, and the author is told.

  And there is no second guard: `max` counts **occurrences** on a repeatable slot, not characters,
  so the manifest can cap how many slides a week has and cannot cap one line inside a slide.

  **A wrong render that no test caught, found by looking at one.** A path vector's `size` is its
  viewport — `export-html` writes it as the `viewBox` — so it has to be the box the `d` was drawn
  in, with the appearing size coming from `transform: { scaleX, scaleY }`. Passing the drawn size
  clips the geometry to a fraction of itself in both exporters with no diagnostic anywhere. It is
  now a paragraph in `docs/template-conventions.md` and two assertions.

  **Measured.** 20 tests in `@tyto/templates` and 37 in `@tyto/contract-test`, the latter with the
  bundled faces so the overflow claims are about text that was actually measured. Three
  perturbations, to prove the suites hold the three promises: dropping the stated box height
  reddened **1 of 37** and nothing in the unit suite, drawing the cover on every slide reddened
  **2 of 20**, and sizing a mark at its drawn size reddened **2 of 20**. `pnpm check`: 70 of 70
  tasks, 0 cached.

  **Two things the assets are not.** The owl and the arrow are geometry written for this card, not
  lifted from the brand files, which are not in this repository — swapping them in is changing `d`
  and `box` on two constants, and no call site names a coordinate. The calendar illustration is an
  optional `image` slot the example brief does not fill, so the cover ships with its words and no
  picture.

  `tyto template check` still reads `manifest.yaml` and `template.html`, so it reports a read
  failure for this folder and the pack's acceptance test routes around it. TYTO-170.

### Patch Changes

- Updated dependencies [80a03a8]
  - @tyto/core@0.23.0
  - @tyto/template-kit@0.1.1

## 0.3.0

### Minor Changes

- 353c83d: TYTO-166 — ADR 0005 gave a template two routes and only one of them ran. A template whose body
  is code could be written, and nothing could draw it.

  **The gap was narrower than it looked.** `compile` already executes any `Template`; it calls
  `template.build(context)` and does not care where the object came from. What was missing was
  the wiring that hands it one: both composition roots composed `markupTemplateSource` and no
  other source.

  **`bundledTemplateSource` is that wiring, and it is not a loader.** Nothing reads a path,
  imports a module or executes anything a scan discovered. It serves code the build already
  holds — a first-party template compiled and shipped with the application, exactly like the
  built-in pack — and pairs each function with the manifest the registry already parsed.

  The refusal it does not touch stays where it was: running code that arrived in a folder is the
  plugin host's job, with its permissions and its isolation (ADR 0007). A `template.ts` dropped
  into a template directory is inert, and there is a test that says so rather than a comment.

  **The manifest stays YAML and a module never declares its own.** The registry answers what
  templates exist and what each declares without importing a line of template code, so a picker
  can list templates nobody asked to run; a manifest written in TypeScript would make opening
  that picker execute every template on the machine. So a module contributes only its `build`,
  and the two meet in the source, which is the first place that has both.

  **A name with two bodies is refused rather than resolved.** Shipped code plus a `template.html`
  in the same folder is the new `E_TEMPLATE_AMBIGUOUS`. It is not `E_TEMPLATE_DUPLICATE`, which
  is about two folders: the registry sees one manifest here and is right to, so only whoever
  loads the build can notice. A silent winner would be a template that changes behaviour the day
  somebody edits the file it was ignoring.

  **Measured.** 63 tests in `@tyto/pipeline`, including two that drive `runJob` end to end with a
  code template — real parser, real `resolve`, real `compile`, shipped exporters — to PNG and
  SVG. The three promises of the new module were perturbed to prove the suite protects them:
  skipping the ambiguity check reddened **1 of 61**, returning a wrapper instead of the function
  that was handed over reddened **1 of 61**, and answering the unknown-manifest case here instead
  of delegating reddened **1 of 61**.

  **Composed in three places**, so the window and the terminal agree: the CLI's `templateWiring`,
  the desktop's export path, and the desktop's preview. A preview that could not draw a code
  template would send somebody to the CLI to find out whether their work rendered.

  **`BUILT_IN_TEMPLATE_BUILDS` ships empty**, and `@tyto/templates` gains `@tyto/core` as a
  dependency because a template written in TypeScript imports the SDK by necessity. The first
  entry is the Agenda carousel (TYTO-167). A pack that shipped a code template before anybody
  had written one would be the mistake ADR 0022 recorded about itself.

  **`W_UNUSED_SLOT` cannot fire on this route**, and `docs/template-authoring.md` now says so.
  `renderedSlots` is derived by reading a markup body; a function has no body to read, so
  `resolve` is told nothing rather than told "none". The silence means _nobody checked_, not
  _every slot is drawn_.

### Patch Changes

- Updated dependencies [353c83d]
  - @tyto/core@0.22.2

## 0.2.0

### Minor Changes

- eb57af0: TYTO-66 find the built-in templates without being pointed at them

  `loadTemplateRegistry` takes a search path instead of one root: `roots: string | readonly
string[]`, in precedence order, **earlier wins** (ADR 0020). The string form is unchanged
  and behaves exactly as it did.

  Two collisions, two answers. Two folders inside one root stays `E_TEMPLATE_DUPLICATE`,
  because directory order is nobody's decision. The same name in a later root is the new
  `W_TEMPLATE_SHADOWED`, on the `ok` branch, naming both folders — that order is one somebody
  chose. A root listed twice is de-duplicated, so a folder cannot shadow itself. `Err` is now
  reserved for _every_ root being unreadable; one bad root beside a good one is a failure on
  that root.

  `@tyto/templates` exports `BUILT_IN_TEMPLATES_DIRECTORY` and `BUILT_IN_TEMPLATE_NAMES`, and
  adds `./package.json` to its `exports` so a composition root can locate the folder. The
  package stays pure: it names its subfolder and reads nothing.

  `tyto render` now finds `promo-curso` and `carrossel-lista` with no `--templates` flag, and
  a project's own template of that name wins over the built-in.

## 0.1.0

### Minor Changes

- c131134: The first two built-in templates: `promo-curso` and `carrossel-lista`.

  Manifest-plus-markup folders under `templates/`, the same shape a designer writes by hand
  and the same one `tyto template check` validates. Both render in feed and story, draw the
  repository's bundled Source Sans 3 rather than carrying their own copy, and come with an
  example brief that is checked on every run.

  The folders are in the package's `files` now, so they publish with it. **Registering them
  as a `template-pack` is still open**: locating a published package's directory at runtime
  and merging a built-in pack with `--templates <dir>` is a decision across three packages
  and wants an ADR. Until then they are used as a folder, which is what they are.
