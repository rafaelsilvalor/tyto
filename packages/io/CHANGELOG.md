# @tyto/io

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
