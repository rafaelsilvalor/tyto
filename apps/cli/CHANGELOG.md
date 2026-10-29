# @tyto/cli

## 0.7.0

### Minor Changes

- a5912e7: TYTO-439: plugin files resolve configurations and aliases (ADR 0151, ADR 0153). A configuration in `~/.tyto/plugin-files/*.yaml` or a trusted workspace's `.tyto/plugin-files/*.yaml` is reached by its alias — `<template>-<configuration>` when the file writes none — and the entry's `default` by the template's own name; every other configuration starts from the `default`. `tyto render` and `tyto watch` render an alias as its template with that configuration's values, the template's defaults under them and a caller's over them. A fetched pack offers only the templates its files name. `@tyto/core` adds `resolveTemplateConfigurations`, the `TemplateConfigurations` a `resolve` and a job look a name up in first, `ResolvedBrief.configuration` and `values`, `TemplateRoot` (`loadTemplateRegistry` takes a root that offers only some names) and `E_TEMPLATE_ALIAS_TAKEN`; each value is checked once, in the file that wrote it. `@tyto/plugin-api` keeps a range per configuration value, adds `configuredTemplates`, and carries `values` in a template call: **the isolation protocol is 10**, so a plugin process on 9 is refused at `hello`, and a manifest whose `engine` asks for `^0.7` is refused by this release's engine check until its range moves. `@tyto/io` adds `pluginFileImages`, which reads an image path relative to its file and keeps it inside the workspace or `TYTO_HOME`, `SyncedFolder.files` and `InstalledPacks.owners`. `@tyto/pipeline`'s `JobPorts` takes `configurations`.

### Patch Changes

- Updated dependencies [a5912e7]
  - @tyto/core@0.31.0
  - @tyto/plugin-api@0.8.0
  - @tyto/io@4.2.0
  - @tyto/pipeline@0.12.0
  - @tyto/export-html@0.7.4
  - @tyto/export-svg@2.0.4
  - @tyto/fonts@0.4.0
  - @tyto/google-fonts@0.1.3
  - @tyto/raster@0.2.2
  - @tyto/template-lang@0.8.3
  - @tyto/templates@1.0.5

## 0.6.0

### Minor Changes

- 7115286: TYTO-432: the CLI fetches what the plugin files name (ADR 0151). `tyto plugin sync` reads `~/.tyto/plugin-files/*.yaml` and a trusted workspace's `.tyto/plugin-files/*.yaml`, fetches each source with the person's own `git` into `~/.tyto/cache/plugin-files/`, and pins the commit in `plugin-files.lock.json`; `--update` moves a branch, and nothing else does. `tyto render` runs the same sync without moving anything, so it reaches the network only for a copy that is missing, and loads each copy as an installed plugin. A source that cannot be reached loads the copy fetched before and says so. `tyto plugin clean` deletes the copies no lock names. `@tyto/plugin-api` gains the plugin-file parser and the lock's schema, `@tyto/io` the fetch, cache and lock adapters, and `@tyto/core` the `*_PLUGIN_FILE_*` diagnostic codes.

### Patch Changes

- Updated dependencies [7115286]
- Updated dependencies [46a0b89]
  - @tyto/core@0.30.0
  - @tyto/io@4.1.0
  - @tyto/plugin-api@0.7.0
  - @tyto/templates@1.0.4
  - @tyto/export-html@0.7.3
  - @tyto/export-svg@2.0.3
  - @tyto/fonts@0.4.0
  - @tyto/google-fonts@0.1.2
  - @tyto/pipeline@0.11.2
  - @tyto/raster@0.2.2
  - @tyto/template-lang@0.8.2

## 0.5.2

### Patch Changes

- Updated dependencies [8ece763]
  - @tyto/templates@1.0.3

## 0.5.1

### Patch Changes

- Updated dependencies [a558c12]
  - @tyto/plugin-api@0.6.0
  - @tyto/export-html@0.7.2
  - @tyto/export-svg@2.0.2
  - @tyto/google-fonts@0.1.1
  - @tyto/io@4.0.1
  - @tyto/pipeline@0.11.1
  - @tyto/raster@0.2.2

## 0.5.0

### Minor Changes

- 3921252: TYTO-254 (ADR 0145): an installed plugin can declare a setting. `registerConfiguration` takes a `form` instead of a `schema` — a scalar of one type with JSON Schema's bounds, an enum, a `tyto-pattern/1` pattern, `format: 'uri'`, or a list of one scalar; no object, no secret — which the host converts with `settingSchemaOf` and validates like any setting, with the same ranged `W_SETTING_INVALID`. The `configuration` point crosses the isolation boundary as data; an isolated plugin that passes a Zod `schema` is refused by name and told to use `form`. The isolation protocol is 7: the host sends a plugin its settings in a `configure` message whenever its host is configured, `InProcessHost.configure` emits a new `configured` host event, and `host.config` in the plugin's process answers the newest. The CLI never reads the window's `settings.json`: an installed plugin's settings take their defaults there.
- 488e0d6: TYTO-278: `tyto render` finds the workspace a brief is in by walking up to the nearest `.tyto/project.json`, and uses its template, asset and font folders; `--out` is optional when the project declares `output`, and a typed `--out` or `--templates` still wins. An untrusted workspace renders with everything inside its own folder and prints why a key that leads outside was left out; `--trust` lifts that for one run without writing an approval, and `tyto trust remove <folder>` takes one back (ADR 0111, ADR 0112).
- 91efbbb: TYTO-280: `tyto render` and `tyto watch` draw images and fonts an installed plugin supplies (ADR 0117, ADR 0118). A `test:logo` image or a face no folder has is fetched once into `TYTO_HOME/cache/sources/`, and the next render asks nothing; a face that arrives makes the job compile once more, so its lines break against it. `tyto render` fetches for a trusted folder and for a brief in no folder; a restricted folder and `tyto watch` read the cache only, each miss saying why. A `--folder` delivery copies a fetched image under a name from its reference (`assets/logo.png`) and points the copied brief at it, so the delivery renders without the plugin. `@tyto/io`'s `sourceCache` takes the miss's reason as `notFetchedBecause`, and its delivery names fetched images that way.
- ae75027: TYTO-281: a template's font this machine lacks is fetched from Google Fonts on first use (ADR 0120). `@tyto/google-fonts` is a new built-in `font-source`, pure, that reaches Google only through `host.fetch` and knows which families Google serves from a bundled snapshot; the face is cached in `TYTO_HOME` and every later render reads it. A missing family nobody can supply — CircularXX — is never fetched and gets one line, the new `W_FONT_UNAVAILABLE` in `@tyto/core`, naming the substitute and the free alternatives the template's manifest lists under the new `fonts` key. `tyto render` and `tyto watch` turn it off with `--no-google-fonts` or `TYTO_GOOGLE_FONTS=off`, and then a missing face is `W_FONT_SUBSTITUTED` exactly as before.
- d3df40e: `--formats` on `tyto render` and `tyto watch` now narrows the brief's `formats:` line instead of being ignored when the brief has one (TYTO-332, ADR 0107). A size the flag names that the line does not have is `E_FORMAT_NOT_IN_BRIEF`, so `watch --formats story` on a brief that does not list `story` now reports an error where it used to render the brief's formats.
- 4aba89c: TYTO-347: a workspace's `.tyto/project.json` can name a work profile, a sheet many folders share (ADR 0114). `"profile": "saude"` reads `TYTO_HOME/profiles/saude/profile.json`, trusted by where it lives; a path names a profile file elsewhere, which is its own source in `trust.json` and is confined to its own folder until it is trusted. The profile's keys come first and the folder's win key by key. `core` reads the key with `profileReferenceOf`, refuses a restricted folder a profile path outside it, ignores a profile's own `profile` key (`W_PROFILE_NESTED`), and says in `ResolvedProject.origins` which sheet each value came from; `W_PROJECT_PROFILE_UNSUPPORTED` is replaced by `W_PROJECT_PROFILE_INVALID` and `W_PROJECT_PROFILE_MISSING`. `@tyto/io`'s `loadWorkspace` reads the profile with its own trust answer and follows its paths through `realpath`. `tyto render` uses it, prints a profile's problems against the profile's file, `--trust` covers the folder and its profile for the run, and `tyto trust remove` takes a profile file's approval back. The window resolves a folder's profile through the same loader; showing it is the next change.
- 3fa8604: TYTO-349: the command line can trust a workspace folder for good. `tyto trust add <folder>` prints what the folder does while restricted (a key that leads outside it, withheld plugin sections, its profile's problems), then writes the approval to `TYTO_HOME/trust.json` under the folder's real path, with no y/N prompt so a script can run it. It refuses a path that does not exist and the folder whose `.tyto` is `TYTO_HOME` (ADR 0112), accepts a folder with no project file, and says which `tyto trust add <file>` trusts the work profile the folder names. `tyto trust add <file>` trusts a shared profile file on its own (ADR 0114); one inside `TYTO_HOME` is already trusted by where it lives. `tyto trust list` prints each approval with its date and marks one whose path is gone. `fsTrustStore` in `@tyto/io` gains `list()`, off the core `TrustStore` port.
- 6511c41: TYTO-371 (ADR 0138): the CLI implements a plugin's private cache and its workspace files. `@tyto/io` adds `pluginCache({ home })`, which keeps each entry at `TYTO_HOME/cache/plugins/<plugin>/<sha256(key)>.bin` beside a `{ key, storedAt, size }` sidecar, both written atomically and dated by the host's clock, and `workspaceFiles({ folder, trust })`, which reads the folder and its trust on every call, refuses a restricted folder with `E_WORKSPACE_FILE_RESTRICTED`, confines a path again after `realpath`, refuses a write that lands in `.tyto/` through a link, and creates the folders a write needs. `workspaceDataResolver` now shares its containment check with it. `tyto render` gives plugins both, against the brief's workspace and its trust (`--trust` counting); a brief in no workspace answers that no folder is open. `tyto watch` gives the cache only, and its refusal names it.
- ffd4770: TYTO-428: `tyto render --section <plugin>.<key>=<value>`, repeatable, sets one key of a plugin's section of `.tyto/project.json` for the run, over what the file says. The value is JSON when it parses and the typed text otherwise. It applies in an untrusted folder too, where the file's own sections stay withheld; a flag of another shape is a usage error (ADR 0147).

### Patch Changes

- 689e872: TYTO-336: `tyto render` and `tyto watch` in a folder with no `formats.yaml` render with the built-in pack's formats, as the window does, instead of stopping with `E_FORMATS_READ`. A `--formats-file` that is not there still fails with `E_FORMATS_READ`, and a `formats.yaml` that is there and malformed still fails as before.
- 93fcb8b: `tyto render` exits 2 (internal failure, worth retrying) when an artwork file is held open by another program, and writes no `result.json`; it used to exit 1 with `E_OUTPUT_WRITE` (TYTO-245, ADR 0108). A folder where an artwork goes still exits 1, now reported as `E_OUTPUT_FILE_BLOCKED` with the folder's path.
- 8e9c9c4: TYTO-329: `tyto render` exports a brief with `*italic*` over a template in Source Sans 3, and reports a face the fonts cannot answer as `E_FONT_FACE_UNAVAILABLE` before the export (ADR 0110).
- 58f54d6: TYTO-370 (ADR 0134): an installed plugin can store and forget its own secrets. `host.credentials` is now a function with two methods: `host.credentials(key)` reads as before, `host.credentials.set(key, value)` stores, and `host.credentials.delete(key)` forgets and answers whether there was a value. Both need the same `credentials:<key>` permission, so an undeclared key is `E_PERMISSION`, in process and across the isolation boundary. A value is a non-empty string of at most 16 KiB in UTF-8 (`CREDENTIAL_VALUE_LIMIT_BYTES`); over it is the new `E_CREDENTIAL_TOO_LARGE` from `@tyto/core`. `HostCapabilities` gains optional `storeCredential` and `deleteCredential`; a host without them answers the new `E_CREDENTIAL_READ_ONLY`. The isolation protocol is 5. The desktop stores in the keychain, under the `plugin:<name>:<key>` account it already reads, lets a plugin's panel store and forget its own declared keys, and holds the plugins screen to the same 16 KiB. `tyto` stays read-only: a plugin's `set` or `delete` there is `E_CREDENTIAL_READ_ONLY`, naming the environment variable to set instead.
- a2b7fbd: TYTO-376 (ADR 0135), second half: a plugin can contribute recipe actions and sinks. A `recipe-verb` of kind `action` or `sink` is accepted now; it declares `writes`, the kinds of write its plans may hold, a subset of a new top-level `writes` in `tyto-plugin.json`, and is refused at load otherwise (a source or a transform declaring `writes` is refused too). Its `plan(request)` answers a `Plan` — `{ target, operations: [{ write, rowKey?, description }], count }`, new in `@tyto/recipe` with `checkPlan` and `PLAN_LIMITS` — and **nothing is written**: the plan rides the cell's result (`Cell.plan`, `VerbOutput.plan`), and the table passes through to the next cell. The host refuses a plan holding a write the verb did not declare, a `count` that is not the number of operations, a `rowKey` the table does not hold, or more than 10,000 operations, with the new `E_RECIPE_PLAN` from `@tyto/core`, placed at the verb. `tyto` loads an installed plugin that contributes them.
- 532221f: TYTO-376 (ADR 0135), first half: a plugin can contribute recipe verbs and derivations. `@tyto/plugin-api` has two new extension points, `recipe-verb` (a paged `source` or a `transform`, with its arguments declared as a small closed schema) and `recipe-derivation` (for `derive`), both named `<namespace>.<name>` in the one `namespace` a manifest now declares and owns alone; a second plugin claiming a loaded plugin's namespace is refused with `E_PLUGIN_NAMESPACE_TAKEN`, and an `action` or `sink` verb is refused until the second half. They cross to an installed plugin's process, and `recipeRegistriesOf(registry)` hands the recipe runner its verb and derivation registries. `@tyto/recipe` gains `checkTable`, `readArguments` and `pagedSource`, which loops a source page by page under provisional ceilings (8 MiB and 5,000 rows per page, 100,000 rows, 1,000 pages) and refuses a repeated cursor or a truncated page rather than answer a partial table; a plugin's derivation may be namespaced. `@tyto/core` gains `E_PLUGIN_NAMESPACE_TAKEN`, `E_RECIPE_TABLE`, `E_RECIPE_SOURCE` and `E_RECIPE_VERB`. `tyto` loads an installed plugin that contributes them.
- Updated dependencies [d4a6939]
- Updated dependencies [08b936d]
- Updated dependencies [7342c02]
- Updated dependencies [15997e9]
- Updated dependencies [15997e9]
- Updated dependencies [49c1569]
- Updated dependencies [93fcb8b]
- Updated dependencies [ea97dc3]
- Updated dependencies [3921252]
- Updated dependencies [aac15e5]
- Updated dependencies [c005b91]
- Updated dependencies [cbbf6df]
- Updated dependencies [2495d0d]
- Updated dependencies [6abf89f]
- Updated dependencies [91efbbb]
- Updated dependencies [017d381]
- Updated dependencies [53e01c3]
- Updated dependencies [ae75027]
- Updated dependencies [fe85505]
- Updated dependencies [5a0c7c5]
- Updated dependencies [bf3fd0e]
- Updated dependencies [8e9c9c4]
- Updated dependencies [ab9512e]
- Updated dependencies [d3df40e]
- Updated dependencies [49db8d1]
- Updated dependencies [4aba89c]
- Updated dependencies [3fa8604]
- Updated dependencies [e4255e4]
- Updated dependencies [58f54d6]
- Updated dependencies [d247c20]
- Updated dependencies [6511c41]
- Updated dependencies [7a5f578]
- Updated dependencies [3355317]
- Updated dependencies [eb55249]
- Updated dependencies [a2b7fbd]
- Updated dependencies [532221f]
- Updated dependencies [5f98674]
- Updated dependencies [cfa70ff]
- Updated dependencies [bdab5da]
- Updated dependencies [eb0694a]
- Updated dependencies [7704e9c]
- Updated dependencies [dded20c]
- Updated dependencies [320c0c7]
- Updated dependencies [c7cf84e]
- Updated dependencies [e4ce1e8]
- Updated dependencies [fdcfda9]
- Updated dependencies [4186112]
- Updated dependencies [3da246d]
- Updated dependencies [885d0f5]
- Updated dependencies [3921252]
- Updated dependencies [0f5ad72]
- Updated dependencies [ffd4770]
- Updated dependencies [431bf23]
  - @tyto/plugin-api@0.5.0
  - @tyto/core@0.29.0
  - @tyto/io@4.0.0
  - @tyto/pipeline@0.11.0
  - @tyto/fonts@0.4.0
  - @tyto/google-fonts@0.1.0
  - @tyto/raster@0.2.2
  - @tyto/templates@1.0.2
  - @tyto/export-html@0.7.1
  - @tyto/export-svg@2.0.1
  - @tyto/template-lang@0.8.1

## 0.4.1

### Patch Changes

- b20fe47: A file sitting where a delivery needs a folder is now an error diagnostic instead of a crash
  (TYTO-129). `fsDeliveryOutput` returns `Result<DeliveryOutput, Diagnostic[]>` instead of
  throwing when a file holds the name of the delivery folder or of `editaveis/`, and
  `deliverAssets` answers a file holding `assets/` the same way. Both use the new code
  `E_DELIVERY_FOLDER_BLOCKED`, which names the path. A folder that really cannot be written to
  (no permission, full disk) still throws.

  **Breaking for `@tyto/io` callers:** check `.ok` on what `fsDeliveryOutput` returns before you
  use the output.

  `tyto render --folder` exits 1 with that diagnostic, where it used to exit 2 with a stack
  trace, so a caller that follows the render contract no longer retries forever. The desktop
  export box shows it under "Finished with problems" instead of the raw `ENOTDIR` text.

- 7dad141: Inline SVG markup is refused unless it is flat geometry (TYTO-168, ADR 0068). Nothing used to
  sanitise a `Vector` of kind `svg`, though the schema said something did, so two icons exported
  from Illustrator — both declaring `.cls-1` — repainted each other in one artwork, and a file
  could carry anything else a browser runs.

  `@tyto/core` exports `checkSvgMarkup` and `SVG_MARKUP_WAY_OUT`, and `parseScene` refuses markup
  outside the subset as the new code `E_SCENE_SVG_MARKUP`, naming the node. The subset is shape
  elements (`svg`, `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, plus
  `title` and `desc`) painted by presentation attributes, with nothing that names anything: no
  `<style>`, `class`, `id`, `<defs>`, `url()` or inline `style`.

  `@tyto/template-lang` reports a literal `<vector src>` whose file is outside the subset as
  `E_TEMPLATE_MARKUP` on the `src` value, before any brief is written.

  `@tyto/export-html` and `@tyto/export-svg` run the same check before they inline, answer
  `E_EXPORT_UNSUPPORTED` for a scene that bypassed `parseScene`, and draw nothing for that node.

  **Breaking for authors:** a file with a stylesheet, classes, gradients, ids, text, images or
  filters used to render and is now an error. Re-export it from Illustrator with Styling set to
  Presentation Attributes, draw it as a `kind: 'path'` contour, or place it as a PNG.

- 4532332: A folder sitting where Tyto writes a file is now an error diagnostic instead of a crash
  (TYTO-243, the mirror of TYTO-129). The copied brief, `template.txt`, `result.json`, an image
  in `assets/` and an artwork file are all covered, under `--folder` and, for `result.json` and
  the artwork, under `--out` too. The new code `E_OUTPUT_FILE_BLOCKED` names the path. A file
  held open by another program, a folder without permission and a full disk still throw.

  **Breaking for `@tyto/io` callers:** `TaskOutput.finish` and `DeliveryOutput.describeTemplate`
  now return `Promise<Diagnostics>`. Report what they answer: `finish`'s diagnostics cannot be in
  the `result.json` that was not written, and `describeTemplate`'s belong in the one `finish`
  writes.

  `tyto render --folder` exits 1 with that diagnostic, where it used to exit 2 with a stack
  trace for every file but the artwork. The artwork was already exit 1, and its `E_OUTPUT_WRITE`
  now carries the same sentence instead of the raw `EPERM … rename` text. The desktop export box
  shows the diagnostic under "Finished with problems" instead of an `EPERM` failure.

- Updated dependencies [b20fe47]
- Updated dependencies [7dad141]
- Updated dependencies [4532332]
  - @tyto/io@3.0.0
  - @tyto/core@0.28.0
  - @tyto/template-lang@0.8.0
  - @tyto/export-html@0.7.0
  - @tyto/export-svg@2.0.0
  - @tyto/fonts@0.3.0
  - @tyto/pipeline@0.10.1
  - @tyto/plugin-api@0.4.1
  - @tyto/raster@0.2.1
  - @tyto/templates@1.0.1

## 0.4.0

### Minor Changes

- 0937670: TYTO-204: an asset path in a brief is read as written, from the brief's folder first, and from `assets/` beside the brief when nothing is there (ADR 0056). The same rule holds in `tyto render`, `tyto watch`, the desktop queue, preview, export box and the template editor's preview, so a folder with its images in `assets/` renders the same in the CLI and in the app. `./assets/logo.png` now resolves everywhere, and when a file of the same name exists both beside the brief and in `assets/`, the one beside the brief wins. `tyto render --assets <dir>` still names the one folder searched, with no fallback. `E_ASSET_NOT_FOUND` now says it looked in `assets/` too.

  `@tyto/io` migration: `BriefTask.assetBase` is now `briefDirectory` (the brief's folder); resolve assets with `briefAssetResolver`.

- d9d77d9: TYTO-223: `tyto render` and `tyto watch` hand each template the brand kit its manifest's `brand`
  names, from the built-in and installed plugins (ADR 0063). When two plugins offer one brand, the
  one registered first is used and `W_BRAND_KIT_SHADOWED` in `result.json` names the one it hid.
- 8ca8eed: TYTO-205: a delivery carries its brief in `editaveis/` and the images the brief used in `assets/` (ADR 0057). The desktop export box now delivers into the picked folder — artwork at the top, `editaveis/`, `assets/` — and `tyto render --folder` gains `assets/` under its `<out>/<brief-name>/` level. The copied brief's image paths name the copies, and a brief in a folder named `editaveis` also reads `../assets`, so it renders again from where it sits. `E_ASSET_NOT_FOUND` names the folders actually searched.
- a84b756: TYTO-127: exporting again into a folder used before removes what the previous export wrote there and this one did not produce, and says so (ADR 0054). It applies to `tyto render --folder` and to the desktop's export box. `--out`, `tyto watch` and the queue panel are unchanged.

  A carousel edited from four slides down to three no longer delivers the fourth, and a delivery made before ADR 0053 loses its `lamina-*` files on the first export after the upgrade. Only a file the previous `result.json` listed can go, and only while its size is still the recorded one. A file somebody added or replaced by hand stays. Each removal is a `W_LEFTOVER_REMOVED` warning on stderr, in `result.json` and in the export box. A kept file is a `W_LEFTOVER_KEPT` with the reason, and a previous report that cannot be read is a `W_PREVIOUS_RESULT_UNREADABLE`.

  `@tyto/io`: `fsTaskOutput` takes `removeLeftovers` and, like `fsDeliveryOutput`, returns a `ReusableTaskOutput` whose `removeLeftovers(run)` is called before `finish`.

- a888001: TYTO-197: exported files are named by format and number: `<format>-<NN>.<ext>` (ADR 0053). The artwork's id stays in `result.json`, beside each file's name.

  ```
  before (TYTO-194)            after
  lamina-1-grid.png            grid-01.png
  lamina-2-grid.png            grid-02.png
  artwork-1-grid-1x1.svg       grid-1x1-01.svg
  lamina-3-story.png           story-03.png
  ```

  The number counts from 01 in slide order and is the same width across a delivery (three digits only past 99 slides). The pixels are unchanged. A script that reads the output folder by name must use the new names; one that reads `result.json` keeps working. Re-exporting into a folder that holds a delivery from before this change leaves the old-name files beside the new ones (TYTO-127).

  `@tyto/pipeline`: `artifactName(format, number, extension)` replaces `artifactName(artwork, format, extension)`, and `artworkNumber(index, count)` is exported.

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

- d4aac5b: TYTO-189: an installed plugin can ship code templates, and they run in its own thread. A folder
  in an installed pack with a `manifest.yaml` and no `template.html` is drawn by the pack's new
  `build(template, context)`, called through the isolation with the 30 s deadline. The frame is
  checked against the IR, and a timeout, throw or refused answer is `E_PLUGIN_TEMPLATE`, which
  costs that frame and not the render. `context.measure` still answers synchronously. The manifest
  lists the faces it measures under `faces:`, and those cross with the call. A face installed on
  the machine crosses only under the `font:<family>` permission (`W_PLUGIN_FONT_WITHHELD` otherwise).
  `tyto plugin new --code` scaffolds one that installs and renders on the first try. `compile` is
  unchanged for every other template, and `compileDeferred` is the new path (ADR 0048).
- cd25d2d: TYTO-50: an installed template pack now reaches a render. `tyto render` and `tyto watch` search
  the templates an installed plugin registers, after the project's and the built-in pack's, and a
  name an earlier source holds is reported as `W_TEMPLATE_SHADOWED`. A pack's `directory` must be
  relative to the plugin's installed folder and stay inside it (`E_PLUGIN_PACK_DIRECTORY`), and every
  template in it must be markup (`E_PLUGIN_PACK_CODE`). Either refusal skips the whole plugin
  (ADR 0046). `tyto plugin new <name>` scaffolds a template pack that installs and renders
  unedited, and `docs/plugin-authoring.md` walks one from scaffold to render.
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

- 7659e7e: `tyto template check` warns with `W_SLOT_VOCABULARY` when a manifest names a slot against the
  standard vocabulary in `docs/slot-vocabulary.md`: a known synonym (`emblema` for `imagem`,
  `slide` for `lamina`, `cor` for `tom`…), a reserved name with the wrong shape, or a repeatable
  slot not named `lamina`. It is a warning and never fatal, and a name the document does not list
  is never flagged. `checkSlotVocabulary` is exported from `@tyto/core`.

  The template scaffold (`tyto template new`, the desktop's New template, `tyto plugin new`)
  names its look-variant slot `tom` instead of `cor`, so a new template starts without the
  warning. A scaffolded brief writes `tom: laranja`.

- 1ee0051: TYTO-44 — the desktop app has a template mode. _File ▸ Edit template…_ opens a markup template
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

- 5f4c609: TYTO-214: `tyto render` and `tyto watch` hand a bundled code template the files in its own folder,
  through `context.files` (ADR 0062). Before, a code template could not draw a background kept beside
  its manifest. `fileTemplateAssets`
  now types its `assets` as `TemplateFiles`, which it always was.
- 3faa7e0: TYTO-232: `tyto render` and `tyto watch` exit 0 when a plugin is installed. Closing an idle plugin's process waited for its exit with nothing holding the event loop open, so Node ended the CLI with 13 (an unsettled top-level await) after a render that had succeeded. The rendered files are unchanged.
- 59da287: TYTO-215: `tyto render --types svg` crops a `cover` image the way the window does. The CLI now
  hands the SVG exporter each picture's own size (brief's files first, the template's second), so
  the image is drawn with an explicit transform and a `clipPath` instead of
  `preserveAspectRatio="… slice"`. For the same brief, the CLI's and the window's SVGs are
  byte-identical again. HTML and raster output are unchanged.
- 7bab967: TYTO-189: the desktop app previews and exports an installed plugin's code templates, drawn in the
  plugin's utility process, and they join the Template picker with its other templates. The queue
  still renders PNG only. The plugins screen says which faces installed on this computer a
  `font:<family>` permission sends, and so does `tyto plugin install` before it asks.
- 536046d: TYTO-48: the desktop runs installed, enabled plugins, each in a `utilityProcess` of its own, and
  activates them into every export's host, so an installed exporter's kind is offered by the export
  dialog (`export:kinds`) and exported from it (ADR 0044). `host.fetch` goes through `net.fetch`
  without following redirects; `host.credentials` reads only the keychain entry
  `plugin:<name>:<key>` through `safeStorage`, and answers `E_CREDENTIAL_MISSING` until the app
  has a screen to store one. A crashed plugin is shown as `crashed` on the plugins screen. The
  queue stays PNG-only by decision. `@tyto/plugin-api` gains `startInstalledPlugins`,
  `readInstalledPlugins`, `writeCrash` and `activateInstalled`, the loader both apps now share.
- 5ba2cf8: TYTO-47: the desktop lists its plugins (File > Show plugins): the built-ins it activated and what
  `tyto plugin install` put under `~/.tyto`, with each one's status, permissions and the reason a
  refused one will not load, and the notice that permissions are recorded and not yet enforced. It
  is read-only and activates no installed plugin. Both apps now honour `TYTO_HOME` in place of
  `~/.tyto`.
- 94fdee3: TYTO-50: the desktop lists an installed plugin's templates in the Template picker and previews
  and exports with them, searched after a chosen folder and the built-in pack and checked by the
  CLI's own rule (ADR 0046), now `installedPacks` in `@tyto/io`. A plugin refused over its pack is
  a row in the problems panel and is kept out of the preview, the panels and the export. Installing
  a folder that holds a link no longer fails with an internal error on Windows: a link inside the
  folder is copied as its target, and one that leads out or nowhere is `E_PLUGIN_LINK`, exit 1.
  `PluginStore.add` answers a `Result`.
- 743910b: TYTO-216: `layeredExportResources` in `@tyto/io` puts several sources of export bytes together,
  the first that answers a ref winning, for `asset` and `assetSize`. `tyto render` binds the brief's
  files and the template's through it, in place of its own two copies. No output changes: the CLI's
  SVG for a `cover` image is byte-identical before and after, and to the window's.
- 525639b: TYTO-202: a template reports warnings beside its frame (ADR 0058). `TemplateContext` gains `report`, which takes one of a closed list of codes — the first is `W_TEMPLATE_OVERFLOW` — and `compile` writes the catalog's diagnostic with the artwork, the format and the range of the directive the artwork came from. An installed code template's reports cross back from its plugin's process beside the frame, as `ok({ frame, reports })`, checked against that list. `reportOverflow` in `@tyto/template-kit` reports content that runs past the page, and the weekly mock-exam agendas use it: a slide that runs off the grid now renders with a warning instead of being cut in silence. A context built by hand passes `reportNothing`.
- 1e17fe7: TYTO-211: a task `tyto watch` renders again after its brief lost slides no longer keeps the old
  slides in `outbox/<id>/out/` (ADR 0060). It applies the rule the desktop queue uses (ADR 0059):
  only a file the previous `result.json` listed can go, each removal is a `W_LEFTOVER_REMOVED`
  warning in the new `result.json`, and a run that fails keeps the older files. `tyto render --out`
  is unchanged and still removes nothing.
- Updated dependencies [8f58e18]
- Updated dependencies [bacf1c5]
- Updated dependencies [0937670]
- Updated dependencies [35c8732]
- Updated dependencies [37fd201]
- Updated dependencies [7950dc3]
- Updated dependencies [3574889]
- Updated dependencies [5f4c609]
- Updated dependencies [8300c78]
- Updated dependencies [bf7c79a]
- Updated dependencies [8ca8eed]
- Updated dependencies [a84b756]
- Updated dependencies [536046d]
- Updated dependencies [a33a192]
- Updated dependencies [a888001]
- Updated dependencies [733f779]
- Updated dependencies [d4aac5b]
- Updated dependencies [94fdee3]
- Updated dependencies [8ff5137]
- Updated dependencies [eaf6ece]
- Updated dependencies [3fab91f]
- Updated dependencies [cd25d2d]
- Updated dependencies [5c0611f]
- Updated dependencies [82927c8]
- Updated dependencies [a69f493]
- Updated dependencies [64c75bb]
- Updated dependencies [b1b0745]
- Updated dependencies [091e2a2]
- Updated dependencies [e35546e]
- Updated dependencies [743910b]
- Updated dependencies [861bf8b]
- Updated dependencies [b02313b]
- Updated dependencies [441b545]
- Updated dependencies [7659e7e]
- Updated dependencies [98d432e]
- Updated dependencies [525639b]
- Updated dependencies [1ee0051]
  - @tyto/io@2.0.0
  - @tyto/templates@1.0.0
  - @tyto/core@0.27.0
  - @tyto/plugin-api@0.4.0
  - @tyto/pipeline@0.10.0
  - @tyto/template-lang@0.7.0
  - @tyto/fonts@0.3.0
  - @tyto/export-html@0.6.4
  - @tyto/export-svg@1.3.4
  - @tyto/raster@0.2.1

## 0.3.1

### Patch Changes

- Updated dependencies [b749c43]
- Updated dependencies [17ad960]
  - @tyto/templates@0.6.0
  - @tyto/core@0.26.0
  - @tyto/template-lang@0.6.6
  - @tyto/export-html@0.6.3
  - @tyto/export-svg@1.3.3
  - @tyto/fonts@0.2.0
  - @tyto/io@1.3.7
  - @tyto/pipeline@0.9.1
  - @tyto/plugin-api@0.3.9
  - @tyto/raster@0.2.1

## 0.3.0

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

- 43115e0: `tyto template check` takes a folder along the route `tyto render` would. A code template
  the build ships (`agenda-semana`) no longer fails with a read error for the `template.html`
  it does not have: its manifest is checked and reported, and the report states that the body
  was not checked — a `not checked:` line, or `notChecked` under `--json`. Exit 0 there means
  the manifest is clean. Shipped code with a `template.html` beside it is
  `E_TEMPLATE_AMBIGUOUS`, as at render time, and a `template.ts` nothing ships gets a hint
  saying folder code is never loaded. Markup folders are checked exactly as before.
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

- Updated dependencies [8092940]
- Updated dependencies [b587f0d]
  - @tyto/templates@0.5.0
  - @tyto/core@0.25.0
  - @tyto/fonts@0.2.0
  - @tyto/pipeline@0.9.0
  - @tyto/export-html@0.6.2
  - @tyto/export-svg@1.3.2
  - @tyto/io@1.3.6
  - @tyto/plugin-api@0.3.8
  - @tyto/raster@0.2.1
  - @tyto/template-lang@0.6.5

## 0.2.4

### Patch Changes

- 63f24dc: TYTO-174 — `tyto render` places a markup template's diagnostics in `template.html` again. The
  brief's origin was registered over the one `templateWiring` had already recorded, so a
  broken tag on line 15 of the template printed as `promo.brief:15:1`: a real line of a file
  with nothing wrong in it. The first registration now wins, which is what the comment beside
  the second one always said.
- Updated dependencies [8b24969]
  - @tyto/core@0.24.0
  - @tyto/export-html@0.6.1
  - @tyto/export-svg@1.3.1
  - @tyto/io@1.3.5
  - @tyto/pipeline@0.8.2
  - @tyto/plugin-api@0.3.7
  - @tyto/raster@0.2.1
  - @tyto/template-lang@0.6.4
  - @tyto/templates@0.4.1

## 0.2.3

### Patch Changes

- Updated dependencies [80a03a8]
- Updated dependencies [d3587dd]
  - @tyto/core@0.23.0
  - @tyto/export-html@0.6.0
  - @tyto/export-svg@1.3.0
  - @tyto/templates@0.4.0
  - @tyto/io@1.3.4
  - @tyto/pipeline@0.8.1
  - @tyto/plugin-api@0.3.6
  - @tyto/raster@0.2.1
  - @tyto/template-lang@0.6.3

## 0.2.2

### Patch Changes

- Updated dependencies [353c83d]
  - @tyto/pipeline@0.8.0
  - @tyto/templates@0.3.0
  - @tyto/core@0.22.2
  - @tyto/io@1.3.3
  - @tyto/export-html@0.5.5
  - @tyto/export-svg@1.2.3
  - @tyto/plugin-api@0.3.5
  - @tyto/raster@0.2.1
  - @tyto/template-lang@0.6.2

## 0.2.1

### Patch Changes

- Updated dependencies [91b6bc5]
  - @tyto/core@0.22.1
  - @tyto/io@1.3.2
  - @tyto/plugin-api@0.3.4
  - @tyto/pipeline@0.7.2
  - @tyto/export-html@0.5.4
  - @tyto/export-svg@1.2.2
  - @tyto/raster@0.2.1
  - @tyto/template-lang@0.6.1

## 0.2.0

### Minor Changes

- 5309eb2: TYTO-107 — a stage may produce a value and still report errors

  The preview keeps drawing while one directive is half-typed: an unclosed `**` costs that
  directive and nothing else, so the artwork stays on screen and the problems panel names what
  is wrong (ADR 0025). TYTO-108 marked the last good preview as stale; this renders the
  current one, minus the broken part.

  `tyto render` agrees with it. A brief with an unknown slot writes its artifacts, exits 1, and
  its `result.json` is `status: error` with those files listed — _rendered, with errors_, which
  `docs/render-contract.md` now describes.

  A brief with no usable template still renders nothing, and so does one whose frontmatter will
  not parse or that leaves a required slot unset. The gap has to be visible in the artwork
  before a missing required slot can be skipped, and nothing draws it yet.

### Patch Changes

- Updated dependencies [e3f2adc]
  - @tyto/raster@0.2.1
  - @tyto/io@1.3.1
  - @tyto/pipeline@0.7.1

## 0.1.13

### Patch Changes

- Updated dependencies [9b44b9d]
  - @tyto/core@0.19.0
  - @tyto/export-html@0.4.2
  - @tyto/export-svg@1.0.2
  - @tyto/io@1.0.3
  - @tyto/pipeline@0.5.3
  - @tyto/plugin-api@0.2.7
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.7

## 0.1.12

### Patch Changes

- Updated dependencies [4519c36]
  - @tyto/core@0.18.0
  - @tyto/export-html@0.4.1
  - @tyto/export-svg@1.0.1
  - @tyto/io@1.0.2
  - @tyto/pipeline@0.5.2
  - @tyto/plugin-api@0.2.6
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.6

## 0.1.11

### Patch Changes

- @tyto/io@1.0.1
- @tyto/pipeline@0.5.1

## 0.1.10

### Patch Changes

- Updated dependencies [f0d3d25]
  - @tyto/core@0.17.0
  - @tyto/pipeline@0.5.0
  - @tyto/io@1.0.0
  - @tyto/export-svg@1.0.0
  - @tyto/export-html@0.4.0
  - @tyto/plugin-api@0.2.5
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.5

## 0.1.9

### Patch Changes

- Updated dependencies [a40f4d9]
  - @tyto/core@0.16.0
  - @tyto/export-html@0.3.4
  - @tyto/export-svg@0.2.4
  - @tyto/io@0.4.5
  - @tyto/pipeline@0.4.3
  - @tyto/plugin-api@0.2.4
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.4

## 0.1.8

### Patch Changes

- Updated dependencies [04c076c]
  - @tyto/core@0.15.0
  - @tyto/io@0.4.4
  - @tyto/pipeline@0.4.2
  - @tyto/export-html@0.3.3
  - @tyto/export-svg@0.2.3
  - @tyto/plugin-api@0.2.3
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.3

## 0.1.7

### Patch Changes

- Updated dependencies [15dfa8b]
  - @tyto/core@0.14.1
  - @tyto/export-html@0.3.2
  - @tyto/export-svg@0.2.2
  - @tyto/io@0.4.3
  - @tyto/pipeline@0.4.1
  - @tyto/plugin-api@0.2.2
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.2

## 0.1.6

### Patch Changes

- Updated dependencies [2f72340]
  - @tyto/core@0.14.0
  - @tyto/pipeline@0.4.0
  - @tyto/export-html@0.3.1
  - @tyto/export-svg@0.2.1
  - @tyto/io@0.4.2
  - @tyto/plugin-api@0.2.1
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.2.1

## 0.1.5

### Patch Changes

- Updated dependencies [81026df]
  - @tyto/export-html@0.3.0
  - @tyto/io@0.4.1
  - @tyto/pipeline@0.3.0
  - @tyto/raster@0.1.0

## 0.1.4

### Patch Changes

- Updated dependencies [b5e8b1b]
  - @tyto/io@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies [607f8e1]
  - @tyto/plugin-api@0.2.0
  - @tyto/pipeline@0.3.0
  - @tyto/export-html@0.2.0
  - @tyto/export-svg@0.2.0
  - @tyto/io@0.3.0
  - @tyto/raster@0.1.0

## 0.1.2

### Patch Changes

- Updated dependencies [a0a6155]
  - @tyto/template-lang@0.2.0
  - @tyto/io@0.2.1
  - @tyto/pipeline@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [e994ca9]
  - @tyto/core@0.13.0
  - @tyto/pipeline@0.2.0
  - @tyto/io@0.2.0
  - @tyto/raster@0.1.0
  - @tyto/template-lang@0.1.3
