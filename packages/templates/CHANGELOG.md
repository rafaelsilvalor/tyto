# @tyto/templates

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
