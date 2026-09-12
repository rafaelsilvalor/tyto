# @tyto/io

## 0.4.5

### Patch Changes

- Updated dependencies [a40f4d9]
  - @tyto/core@0.16.0
  - @tyto/export-html@0.3.4
  - @tyto/export-svg@0.2.4
  - @tyto/pipeline@0.4.3
  - @tyto/template-lang@0.2.4

## 0.4.4

### Patch Changes

- Updated dependencies [04c076c]
  - @tyto/core@0.15.0
  - @tyto/pipeline@0.4.2
  - @tyto/export-html@0.3.3
  - @tyto/export-svg@0.2.3
  - @tyto/template-lang@0.2.3

## 0.4.3

### Patch Changes

- Updated dependencies [15dfa8b]
  - @tyto/core@0.14.1
  - @tyto/export-html@0.3.2
  - @tyto/export-svg@0.2.2
  - @tyto/pipeline@0.4.1
  - @tyto/template-lang@0.2.2

## 0.4.2

### Patch Changes

- Updated dependencies [2f72340]
  - @tyto/core@0.14.0
  - @tyto/pipeline@0.4.0
  - @tyto/export-html@0.3.1
  - @tyto/export-svg@0.2.1
  - @tyto/template-lang@0.2.1

## 0.4.1

### Patch Changes

- Updated dependencies [81026df]
  - @tyto/export-html@0.3.0
  - @tyto/pipeline@0.3.0

## 0.4.0

### Minor Changes

- b5e8b1b: TYTO-46 — the render contract, published.

  `@tyto/io` gains `EXIT_OK`, `EXIT_DIAGNOSTICS`, `EXIT_INTERNAL` and `EXIT_CODES`. They were
  in `apps/cli`, and moved here because they are the other half of the ADR 0011 contract this
  package already owns: `result.json`'s schema lives in `result.ts`, and the exit code a
  caller reads is the same promise made to the same reader. A document generated from the code
  cannot import an app, and two copies of "1 means error diagnostics" is two places for it to
  stop being true. `apps/cli/src/exit.ts` re-exports them, so every command still reads them
  from one import.

  Two generated artefacts ship with it, neither of them in this package:
  `docs/render-contract.md` and `docs/render-result.schema.json`, both written by
  `pnpm docs:gen` and checked for drift by `pnpm check`.

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
  - @tyto/pipeline@0.3.0
  - @tyto/export-html@0.2.0
  - @tyto/export-svg@0.2.0

## 0.2.1

### Patch Changes

- Updated dependencies [a0a6155]
  - @tyto/template-lang@0.2.0
  - @tyto/pipeline@0.2.1

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
  - @tyto/pipeline@0.2.0
  - @tyto/template-lang@0.1.3

## 0.1.0

### Minor Changes

- e3f51a0: The inbox/outbox contract of ADR 0011, as code. `fsInbox` lists `inbox/<id>/brief.brief` with `assets/` as the asset base and `ack` **moves** a finished task to `done/` rather than deleting it; `fsOutbox` writes `outbox/<id>/out/` with every file renamed into place, so no reader can pick up half a PNG — the atomicity the pipeline deliberately delegated. `result.json` has a Zod schema, validated before writing, with `status` answering correctness and `cancelled` plus the counts answering completeness.

  Also the first adapters for two ports `core` has been asking questions of since E3.3, and one the exporters needed: `nodeFileSystem` (`FileSystem`), `fileAssetResolver` (`AssetResolver`, hashing content so the same brief plus the same assets produce the same bytes), and `fileResources`, which reads an asset folder into the synchronous data-URI lookups the exporters take. `pollSource` is the watcher of ADR 0008 — polling, because `fs.watch` reports a folder while it is still being copied into, and it never acks, because only the handler knows whether the work succeeded.
