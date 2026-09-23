# @tyto/plugin-api

## 0.3.6

### Patch Changes

- Updated dependencies [80a03a8]
  - @tyto/core@0.23.0

## 0.3.5

### Patch Changes

- Updated dependencies [353c83d]
  - @tyto/core@0.22.2

## 0.3.4

### Patch Changes

- 91b6bc5: Dependency bumps in the prod group: `yaml` 2.9.0 → 2.9.1, `zod` 4.6.1 → 4.6.5, and
  `@codemirror/commands`, `@codemirror/state` and `@codemirror/view` to their latest patches.

  These are dependencies of what ships, so they get a patch and a line in the changelog rather
  than passing through unnamed. Written by hand because Dependabot cannot write a changeset — it
  has no idea this repository uses them — which is what makes every one of its PRs arrive red on
  `changeset status`. TYTO-155 is the card for fixing that properly.

- Updated dependencies [91b6bc5]
  - @tyto/core@0.22.1

## 0.3.3

### Patch Changes

- Updated dependencies [5309eb2]
  - @tyto/core@0.22.0

## 0.3.2

### Patch Changes

- Updated dependencies [ca8f122]
- Updated dependencies [2cea94a]
  - @tyto/core@0.21.1

## 0.3.1

### Patch Changes

- Updated dependencies [eb57af0]
  - @tyto/core@0.21.0

## 0.3.0

### Minor Changes

- 9b3ecd4: TYTO-35 validate `tyto-plugin.json` and list what is installed

  `@tyto/plugin-api` gains `pluginManifestSchema`, `parsePluginManifest` and
  `validatePluginManifest`: the manifest of `docs/plugin-api.md` as a schema, rejecting with
  a field path (`contributes.1`, `config.$schema`) and reporting every problem at once.

  `InProcessHost.activate(plugin, origin?)` is the door a plugin now comes through. It
  validates the manifest, refuses a `name` that disagrees with the plugin's id, refuses a
  contribution to a point the manifest did not declare, and records the plugin so
  `registry.plugins()` can list it.

  `Plugin` therefore carries a `manifest`, typed `unknown` because a manifest is a document
  to be validated rather than a shape to be trusted. Both exporters ship a real
  `tyto-plugin.json` at their package root and export it as `htmlExporterManifest` /
  `svgExporterManifest`. The unused `id` option is gone from both plugin factories: the
  manifest's `name` is the id, and a second name for one plugin is a second thing to keep in
  step.

  `@tyto/core` adds `E_PLUGIN_MANIFEST_SYNTAX` and `E_PLUGIN_MANIFEST_SHAPE`.

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
