# @tyto/templates

## 0.5.1

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
  `BUILT_IN_TEMPLATE_BUILDS`, which TYTO-166 shipped empty. `agenda-semana` draws the Estratégia
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
