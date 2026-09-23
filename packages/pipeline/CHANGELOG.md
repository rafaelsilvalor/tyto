# @tyto/pipeline

## 0.8.2

### Patch Changes

- Updated dependencies [8b24969]
  - @tyto/core@0.24.0
  - @tyto/brief-lang@0.6.4
  - @tyto/plugin-api@0.3.7
  - @tyto/raster@0.2.1
  - @tyto/template-lang@0.6.4

## 0.8.1

### Patch Changes

- Updated dependencies [80a03a8]
  - @tyto/core@0.23.0
  - @tyto/brief-lang@0.6.3
  - @tyto/plugin-api@0.3.6
  - @tyto/raster@0.2.1
  - @tyto/template-lang@0.6.3

## 0.8.0

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
  - @tyto/brief-lang@0.6.2
  - @tyto/plugin-api@0.3.5
  - @tyto/raster@0.2.1
  - @tyto/template-lang@0.6.2

## 0.7.2

### Patch Changes

- Updated dependencies [91b6bc5]
  - @tyto/brief-lang@0.6.1
  - @tyto/core@0.22.1
  - @tyto/plugin-api@0.3.4
  - @tyto/raster@0.2.1
  - @tyto/template-lang@0.6.1

## 0.7.1

### Patch Changes

- Updated dependencies [e3f2adc]
  - @tyto/raster@0.2.1

## 0.7.0

### Minor Changes

- 801d292: TYTO-121 — `JobReport` says which template the run used

  One optional field, `template`, carrying the manifest of the template the job actually
  loaded. Absent when the run never got that far: a brief that does not parse, or a name no
  registry has.

  **Nothing else could answer it.** The name is the brief's frontmatter or the `--template`
  fallback, and applying that precedence is the job's own rule — a caller that wanted the
  answer had to duplicate it, which `job.ts` already says once is one time too many.
  `result.json`'s `tyto.templates` is a different question: it lists every template that was on
  the search path, so on a project with two templates it answers two names.

  The manifest rides along whole rather than copied field by field, because the point is to
  **name** a template rather than to carry one — a delivery that duplicated the template it used
  would fill a remote with copies of a file that has one home.

  A cancelled run carries it too, as soon as the template stage has loaded one: "which template
  was this going to be" is as true then as it is at the end.

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
  - @tyto/brief-lang@0.6.0
  - @tyto/template-lang@0.6.0
  - @tyto/plugin-api@0.3.3
  - @tyto/raster@0.2.0

## 0.5.12

### Patch Changes

- Updated dependencies [4fad5b9]
  - @tyto/template-lang@0.5.0

## 0.5.11

### Patch Changes

- Updated dependencies [aa6c851]
  - @tyto/brief-lang@0.5.9

## 0.5.10

### Patch Changes

- Updated dependencies [2deabb8]
  - @tyto/template-lang@0.4.0

## 0.5.9

### Patch Changes

- Updated dependencies [8e6c2ef]
  - @tyto/template-lang@0.3.0

## 0.5.8

### Patch Changes

- Updated dependencies [ca8f122]
- Updated dependencies [2cea94a]
  - @tyto/core@0.21.1
  - @tyto/brief-lang@0.5.8
  - @tyto/plugin-api@0.3.2
  - @tyto/raster@0.2.0
  - @tyto/template-lang@0.2.10

## 0.5.7

### Patch Changes

- 2d5b5b8: An unresolved asset says so is a wiring mistake when the job was given no loader (TYTO-69).

  `E_EXPORT_ASSET_UNRESOLVED` names the asset, which is the right answer when the file is
  missing and the wrong place to look when nobody ever read it. An exporter cannot tell those
  apart — its resolver answered `undefined` either way — but the job can, because it is the
  stage that knows whether `loadResources` was supplied at all. So the diagnostic keeps its
  code, its severity and its message, and gains a hint naming the port.

  Assets only: a font resolver is bound ready-made (ADR 0021) and needs no loader, so pointing
  an unresolved face at `loadResources` would name a seam that was never involved. A job that
  was wired correctly sees exactly what it saw before.

## 0.5.6

### Patch Changes

- Updated dependencies [b7fc01a]
  - @tyto/raster@0.2.0

## 0.5.5

### Patch Changes

- Updated dependencies [eb57af0]
  - @tyto/core@0.21.0
  - @tyto/brief-lang@0.5.7
  - @tyto/plugin-api@0.3.1
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.9

## 0.5.4

### Patch Changes

- Updated dependencies [9b3ecd4]
  - @tyto/plugin-api@0.3.0
  - @tyto/core@0.20.0
  - @tyto/raster@0.1.0
  - @tyto/brief-lang@0.5.6
  - @tyto/template-lang@0.2.8

## 0.5.3

### Patch Changes

- Updated dependencies [9b44b9d]
  - @tyto/core@0.19.0
  - @tyto/brief-lang@0.5.5
  - @tyto/plugin-api@0.2.7
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.7

## 0.5.2

### Patch Changes

- Updated dependencies [4519c36]
  - @tyto/core@0.18.0
  - @tyto/brief-lang@0.5.4
  - @tyto/plugin-api@0.2.6
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.6

## 0.5.1

### Patch Changes

- Updated dependencies [64153ab]
  - @tyto/brief-lang@0.5.3

## 0.5.0

### Minor Changes

- f0d3d25: Resources are resolved after `compile`, not before (E6.4).

  `sceneResources(scene)` in `@tyto/core` says what a scene asks the outside world for: every
  `AssetRef` it draws and every `SceneFontFace` its runs ask for, deduplicated, found through
  the one `walk()` rather than through a second recursion. `JobPorts.loadResources` is handed
  that list between `compile` and the first `exportFrame` — the only window where the question
  has an answer and the answer is still useful — and may await. Jobs that use it emit a
  `resources` stage event.

  **The eager path is gone, not kept as a fallback.** `fileResources` no longer reads the
  asset folder and is no longer async: it hands out resolvers over an empty store and a `load`
  that fills it with exactly what the scene named. Keeping both alive would have meant two
  ways for an asset to reach a document and no way to tell which one did. A caller that used
  to `await fileResources(...)` now calls it plainly and passes `resources.load` to `runJob`
  as `loadResources`. The template's own `src=` files are unaffected — `templateWiring` reads
  that folder when it loads the template, which is already after the brief named it.

  **`SvgFontFace` now carries `font: FontRef` instead of `family: string`.** It and
  `HtmlFontFace` are both `SceneFontFace` from `core`, which is what lets one list serve both
  exporters; the two used to describe a face differently, so the same scene produced two lists
  that could not be compared. `FontRef` won because it says strictly more — a family alone
  cannot tell a bundled face from one in the brief's folder, and a loader that has to open a
  file needs the `path`. `face.family` becomes `face.font.family`. Both exporters also key
  their face registries with `core`'s `fontFaceKey`, so a document deduplicates exactly as the
  enumeration counts, and the SVG `@font-face` block is now sorted by that key rather than by
  insertion order.

### Patch Changes

- Updated dependencies [f0d3d25]
  - @tyto/core@0.17.0
  - @tyto/brief-lang@0.5.2
  - @tyto/plugin-api@0.2.5
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.5

## 0.4.3

### Patch Changes

- Updated dependencies [a40f4d9]
  - @tyto/core@0.16.0
  - @tyto/brief-lang@0.5.1
  - @tyto/plugin-api@0.2.4
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.4

## 0.4.2

### Patch Changes

- Updated dependencies [04c076c]
  - @tyto/brief-lang@0.5.0
  - @tyto/core@0.15.0
  - @tyto/plugin-api@0.2.3
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.3

## 0.4.1

### Patch Changes

- Updated dependencies [15dfa8b]
  - @tyto/core@0.14.1
  - @tyto/brief-lang@0.4.9
  - @tyto/plugin-api@0.2.2
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.2

## 0.4.0

### Minor Changes

- 2f72340: Text is measured and wrapped in the IR (E4.5).

  `compile` now takes `faces`, a `FaceCache` built from the new `FontSource` port, and uses it
  to decide where every line of a `TextNode` ends. The breaks come back as `LineBreak` runs,
  so both exporters draw the same lines instead of each guessing — which closes ADR 0019's
  "an SVG does not wrap". `overflow: 'shrink'` is resolved the same way: the runs come out at
  the size that fits and the node becomes `'clip'`, because the shrink has happened.
  `W_TEXT_OVERFLOW` reports what still does not fit, naming the brief's directive and
  carrying its range.

  Measuring is fontkit over the bundled outlines, and it agrees with Chromium: on the
  `text.feed` corpus the line counts match exactly and the block heights are within 0.0125px,
  against a ±1px criterion.

  `JobPorts.faces` passes the cache through `@tyto/pipeline`. Both options are optional and a
  caller that omits them gets exactly the previous behaviour — no adapter supplies fonts to a
  production job yet, so nothing changes for the CLI until one does.

### Patch Changes

- Updated dependencies [2f72340]
  - @tyto/core@0.14.0
  - @tyto/brief-lang@0.4.8
  - @tyto/plugin-api@0.2.1
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.1

## 0.3.0

### Minor Changes

- 607f8e1: TYTO-34 — the plugin host, and the first two built-ins that go through it.

  `@tyto/plugin-api` gains the nine contribution types of `docs/plugin-api.md` and
  `createPluginHost`: an in-process registry with `register*`, `config`, `log`, `events` and a
  `Disposable` per contribution. Pure — it is maps and disposables, and every capability
  arrives from the composition root. `source`, `sink` and `rasterizer` are typed generically
  because their ports are declared in Node packages and this one may not name them (ADR 0010);
  the host stores the value and only reads its id.

  **`runJob` no longer imports an exporter.** It takes `ports.exporters`, asks
  `forKind(kind)`, and branches on the exporter's own `rasterized` flag instead of on
  `kind === 'svg'`. `JobPorts.resources` and the `JobResources` type are gone: what an
  exporter needs for a font or an image now binds when it is registered, which keeps the
  extension point out of the `HtmlFontFace` versus `SvgFontFace` argument that belongs to
  TYTO-62. A new ESLint rule, `boundary/pipeline-has-no-exporters`, keeps it that way — the
  one `eslint.config.js` said would land with E7.1.

  **`OutputRequest` is one shape rather than a union per kind.** It used to say in the type
  which options belong to which exporter, which is the knowledge an extension point takes away
  from the job. An exporter reads what it understands; the rasterizer port still refuses
  `quality` on a PNG where it can actually check.

  `@tyto/export-html` and `@tyto/export-svg` each export their own plugin —
  `htmlExporterPlugin(...)`, `svgExporterPlugin(...)` — so a built-in ships with the thing it
  plugs in and the CLI, the desktop app and every test reach it through one factory. `@tyto/io`
  gains `ExportResources`, the type `JobResources` used to be: it describes bytes read off a
  disk, which is this package's subject and no longer the job's.

  Nothing renders differently. The same briefs produce the same bytes; what changed is which
  module hands them over.

### Patch Changes

- Updated dependencies [607f8e1]
  - @tyto/plugin-api@0.2.0
  - @tyto/raster@0.1.0

## 0.2.1

### Patch Changes

- Updated dependencies [a0a6155]
  - @tyto/template-lang@0.2.0

## 0.2.0

### Minor Changes

- e994ca9: TYTO-33 — what the `tyto` command needed from the packages under it.

  `core`: `ResolveOptions.formats`, the `--formats` flag's way in. It is a **fallback and not
  an override**, mirroring `ResolveOptions.template`: the frontmatter's `formats` still wins,
  so there is one rule for a reader rather than two. A format it names that the manifest does
  not render is the same `E_UNKNOWN_FORMAT` the frontmatter would get, with no range attached
  because a flag is not a position in a file. New diagnostic code `E_INPUT_READ`, for a file a
  command was pointed at and could not open — `E_TEMPLATE_READ` was the nearest thing and its
  summary is about templates.

  `pipeline`: `JobRequest.formats`, passed straight to `resolve`. The job does not filter
  frames afterwards — a frame nobody asked for should never be built, not built and dropped.

  `io`: `fsTaskOutput(directory)`, the `TaskOutput` over one folder that `fsOutbox` is now
  written in terms of. `tyto render --out <dir>` writes into exactly the folder it was given
  (`docs/integrations.md`), while the outbox derives `<root>/<id>/out` from a task id; the
  atomic write underneath is the part neither may have its own copy of. Also
  `fileTemplateAssets(...)`, which reads the files beside a `template.html` that its `src=`
  attributes name — `markupTemplateSource` has always left that to whoever composes it, and
  before this nothing did, so a template with a `<vector src>` could not render.

### Patch Changes

- Updated dependencies [e994ca9]
  - @tyto/core@0.13.0
  - @tyto/brief-lang@0.4.7
  - @tyto/export-html@0.1.3
  - @tyto/export-svg@0.1.3
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.1.3

## 0.1.0

### Minor Changes

- 3a782b3: `runJob`: a brief in, artifacts out. It composes `parseBrief` → `resolve` → `compile` → `export` → `raster` with every capability injected as a port, names each artifact `<artwork>-<format>.<ext>` (ADR 0011), limits how many frames raster at once, and reports progress through a tagged `JobEvent` union. A three-slide brief in two formats asked for as PNG and SVG produces twelve files.

  Two ports are declared here because nothing else could: `TemplateSource`, since `TemplateRegistry` reads manifests and `compile` needs a build function, and `ArtifactSink`, implemented by `io` in E6.2 — a job with no sink returns its artifacts in memory and opens no files. Every frame is attempted individually with `exportFrameHtml`/`exportFrameSvg`, so one broken frame of twelve is reported alongside the other eleven instead of replacing them; an `AbortSignal` stops the job handing anything further to the sink.

  `@tyto/core` gains two diagnostic codes for what a job can report and no stage could: `E_RENDER_FAILED` for a frame that produced no bytes, and `E_OUTPUT_WRITE` for one that could not be written.

### Patch Changes

- Updated dependencies [3a782b3]
  - @tyto/core@0.12.0
  - @tyto/brief-lang@0.4.6
  - @tyto/export-html@0.1.2
  - @tyto/export-svg@0.1.2
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.1.2
