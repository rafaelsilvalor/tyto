# @tyto/plugin-api

## 0.4.0

### Minor Changes

- 37fd201: TYTO-230: a brand kit's logo may be toned layers — `{ box, layers: [{ tone, d, fillRule }] }`, with `tone` `primary` or `secondary` and still no colour — as well as one `MarkShape`, which keeps working as all `primary`; and a kit may carry a `wordmark` under the same rules (ADR 0066). A mark's paths together are bounded by `MARK_PATH_LIMIT`, and a toned mark has at most `MARK_LAYER_LIMIT` (16) layers. The isolation protocol is now version 4. The built-in templates map each tone to a colour of their own, and `banner-roxo` draws the kit's wordmark in its square format; without a kit their output is unchanged.
- 7950dc3: TYTO-223: a plugin contributes a brand kit — a logo mark and a signature per brand id — through
  the new `brand-kit` extension point, and a template reads the kit of its own manifest's `brand`
  from `context.brand` (ADR 0063). `TemplateContext` gains the required `brand` field; a context
  built by hand passes `noBrandKit`. `CompileOptions` and `JobPorts` take `brandKits`, which
  `PluginRegistry.brandKitsByBrand()` merges: the plugin registered first keeps a brand, and
  `W_BRAND_KIT_SHADOWED` names the one it hid. The kit is data and crosses to an installed code
  template with the call, so the isolation protocol is now version 3. `Mark` moves to
  `@tyto/core` as `MarkShape`; `@tyto/template-kit` still exports it as `Mark`.
- 536046d: TYTO-48: the desktop runs installed, enabled plugins, each in a `utilityProcess` of its own, and
  activates them into every export's host, so an installed exporter's kind is offered by the export
  dialog (`export:kinds`) and exported from it (ADR 0044). `host.fetch` goes through `net.fetch`
  without following redirects; `host.credentials` reads only the keychain entry
  `plugin:<name>:<key>` through `safeStorage`, and answers `E_CREDENTIAL_MISSING` until the app
  has a screen to store one. A crashed plugin is shown as `crashed` on the plugins screen. The
  queue stays PNG-only by decision. `@tyto/plugin-api` gains `startInstalledPlugins`,
  `readInstalledPlugins`, `writeCrash` and `activateInstalled`, the loader both apps now share.
- d4aac5b: TYTO-189: an installed plugin can ship code templates, and they run in its own thread. A folder
  in an installed pack with a `manifest.yaml` and no `template.html` is drawn by the pack's new
  `build(template, context)`, called through the isolation with the 30 s deadline. The frame is
  checked against the IR, and a timeout, throw or refused answer is `E_PLUGIN_TEMPLATE`, which
  costs that frame and not the render. `context.measure` still answers synchronously. The manifest
  lists the faces it measures under `faces:`, and those cross with the call. A face installed on
  the machine crosses only under the `font:<family>` permission (`W_PLUGIN_FONT_WITHHELD` otherwise).
  `tyto plugin new --code` scaffolds one that installs and renders on the first try. `compile` is
  unchanged for every other template, and `compileDeferred` is the new path (ADR 0048).
- 94fdee3: TYTO-50: the desktop lists an installed plugin's templates in the Template picker and previews
  and exports with them, searched after a chosen folder and the built-in pack and checked by the
  CLI's own rule (ADR 0046), now `installedPacks` in `@tyto/io`. A plugin refused over its pack is
  a row in the problems panel and is kept out of the preview, the panels and the export. Installing
  a folder that holds a link no longer fails with an internal error on Windows: a link inside the
  folder is copied as its target, and one that leads out or nowhere is `E_PLUGIN_LINK`, exit 1.
  `PluginStore.add` answers a `Result`.
- 5c0611f: TYTO-49: plugin directives (ADR 0043). A plugin registers a `directive` contribution whose `id`
  is its namespace, with the `names` it answers and a `transform` that turns `::ns/name` into
  ordinary slot directives, which `resolve` checks against the manifest as if they were typed. The
  directive's adjustments are the plugin's arguments, handed over parsed and ranged, and the host
  stamps every range in the answer. `ResolveOptions.directives` and `JobPorts.directives` take the
  host's point through `directiveResolverOf`. The CLI wires it into every render, and an installed
  plugin's transform runs in its worker under the per-call deadline. The editor offers `ns/name`
  after `::`. Without the plugin the brief still gives `E_UNKNOWN_DIRECTIVE` on the name, and a
  plugin's refusal of its arguments is the new `E_DIRECTIVE_ARGUMENT`.
- 82927c8: TYTO-48: `PluginHost` gains `fetch` and `credentials` (ADR 0042). `host.fetch` reaches only the
  hosts a manifest declares as `net:<host>`, `net:*.<domain>` or `net:*`, never follows a redirect,
  and rejects anything else with `E_PERMISSION`; `host.credentials(key)` resolves only a
  `credentials:<key>`, and in the CLI reads it from `TYTO_PLUGIN_<NAME>_<KEY>`. The check runs on
  the host's side, for isolated and in-process plugins alike. Every call to an isolated plugin, and
  its activation, has a 30 s deadline: past it the frame answers `E_PLUGIN_TIMEOUT`, the worker is
  ended, and the timeout is recorded as a crash.
- a69f493: TYTO-48: an installed plugin runs in a worker thread of its own, and the `PluginHost` it holds is
  a proxy whose every call is a Zod-checked message (ADR 0041). `@tyto/plugin-api` gains the
  protocol, the `PluginChannel` port, `runGuest` and `connectIsolatedPlugin`; `Exporter.exportFrame`
  may return a `Promise`, which the job awaits. A plugin whose thread ends unasked costs the frames
  waiting on it (`E_PLUGIN_CRASHED`, non-fatal) and is shown as `crashed` in `plugin list` until it
  is installed or enabled again; the history is `crashes.json`, beside `plugins.json`, and
  `plugins.json` now drops keys it does not know instead of refusing the file. The thread is a crash and API boundary, not a sandbox, and the
  install prompt says so.
- 64c75bb: TYTO-47: plugins can be installed. `tyto plugin install <folder|git-url|npm-spec>` checks the
  manifest's `engine` against `PLUGIN_API_VERSION` (the plugin API's own version, ADR 0040), shows
  the permissions — recorded, not yet enforced — and copies the plugin to `~/.tyto/plugins/`;
  `remove`, `disable` and `enable` change what is activated, and `plugin list` gains a status column
  and `--active`. `InProcessHost.tryActivate` activates an installed plugin as data rather than
  throwing, and a plugin whose contribution id is taken is refused by name while the render goes on
  (`W_PLUGIN_SKIPPED`). `ArtifactKind` is open, so `--types` accepts any kind an installed exporter
  declares, and a document exporter's `extension` and `mime` name the file; `artifactExtension` and
  `artifactMimeType` are replaced by `artifactEncoding`, and `artifactName` takes the extension.
- b1b0745: TYTO-49: plugin panels (ADR 0045). A `panel` contribution names a page inside the plugin's
  folder (`entry`) and crosses from an isolated plugin as data. The desktop serves it as
  `tyto-plugin://<plugin>/<entry>`, confined to that folder and with no network, into an iframe
  with `sandbox="allow-scripts"` alone: it cannot read the window, the app's storage or the
  preload, and its frame stays on its own plugin's pages. It asks the host for `fetch` and
  `credentials` through a `postMessage` bridge checked against the plugin's permissions. It hears
  the open brief's text, which the plugins screen now states. It opens closed from the command bar,
  and the bottom dock lays its panels side by side. The template mode's sample brief resolves
  plugin directives.
- 091e2a2: Run each installed plugin in the CLI confined to its own folder by Node's permission model
  (TYTO-186, ADR 0049).

  - **CLI**: a plugin's process is a child process started with `--permission` and read access to
    its installed folder and its bootstrap only, both as real paths. It cannot read other files,
    write, start a process or a worker, or load an addon, and its environment is empty. The
    bootstrap (`dist/guest/plugin-guest.js`) inlines everything it imports. Before the plugin's
    code is imported, the process tries to read a file outside its grant. A plugin whose process
    could read it, or did not say, is refused with `E_PLUGIN_SANDBOX`, which names the runtime.
    The network stays advisory on Node 22 and 24: `net:` filters `host.fetch` only. The install
    prompt says so.
  - **`@tyto/plugin-api`**: `RPC_PROTOCOL_VERSION` is 2, and `hello` carries a `sandbox` report.
    `runGuest` takes that report, `connectIsolatedPlugin` and `startInstalledPlugins` take
    `requireSandbox`, `PluginProcessRequest` gains `directory`, and `PluginStore` gains
    `linksLeaving`, which every load asks before a plugin starts.
  - **`@tyto/core`**: `E_PLUGIN_SANDBOX` is new. `E_PLUGIN_LINK` is also reported at load, and its
    message no longer names install.
  - **`@tyto/io`**: `fsPluginStore` implements `linksLeaving`.
  - **Desktop**: unchanged in behaviour. It does not require the sandbox yet, because a
    `utilityProcess` accepts `--permission` and does not enforce it. The bundled Node that will
    confine it comes in the second TYTO-186 pull request.

- 525639b: TYTO-202: a template reports warnings beside its frame (ADR 0058). `TemplateContext` gains `report`, which takes one of a closed list of codes — the first is `W_TEMPLATE_OVERFLOW` — and `compile` writes the catalog's diagnostic with the artwork, the format and the range of the directive the artwork came from. An installed code template's reports cross back from its plugin's process beside the frame, as `ok({ frame, reports })`, checked against that list. `reportOverflow` in `@tyto/template-kit` reports content that runs past the page, and the weekly mock-exam agendas use it: a slide that runs off the grid now renders with a warning instead of being cut in silence. A context built by hand passes `reportNothing`.

### Patch Changes

- 8300c78: TYTO-214: a code template reads the files in its own folder through `context.files.image(path)`
  and `context.files.svg(path)` (ADR 0062). `TemplateContext` gains the required `files` field, and
  a context built by hand passes `noFiles`. `bundledTemplateSource` takes an optional
  `readFiles(directory)`; without it, a bundled template is handed no files, as before. An
  installed plugin's code template is handed `noFiles`.
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
- Updated dependencies [cd25d2d]
- Updated dependencies [5c0611f]
- Updated dependencies [82927c8]
- Updated dependencies [a69f493]
- Updated dependencies [64c75bb]
- Updated dependencies [091e2a2]
- Updated dependencies [e35546e]
- Updated dependencies [7659e7e]
- Updated dependencies [525639b]
  - @tyto/core@0.27.0

## 0.3.9

### Patch Changes

- Updated dependencies [17ad960]
  - @tyto/core@0.26.0

## 0.3.8

### Patch Changes

- Updated dependencies [b587f0d]
  - @tyto/core@0.25.0

## 0.3.7

### Patch Changes

- Updated dependencies [8b24969]
  - @tyto/core@0.24.0

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
