# @tyto/io

## 5.2.0

### Minor Changes

- 213f553: TYTO-504: the gallery's operations (`readGallery`, `installGalleryEntry`, `updateGalleryEntry`) move into `@tyto/io` and answer what happened as data, so the CLI and the window run the same code; `fetchGalleryIndex` can keep the entries' preview pictures beside the cached index.

### Patch Changes

- Updated dependencies [9021b50]
- Updated dependencies [93fb9c9]
- Updated dependencies [147eafa]
- Updated dependencies [bd56ec5]
- Updated dependencies [9bcb68b]
- Updated dependencies [05c9f83]
  - @tyto/core@0.36.0
  - @tyto/pipeline@0.12.5
  - @tyto/plugin-api@0.13.0
  - @tyto/template-lang@0.8.8
  - @tyto/export-html@0.7.9
  - @tyto/export-svg@2.0.9

## 5.1.0

### Minor Changes

- 6881557: A delivery's export copies the brief's images into its assets folder (TYTO-499, ADR 0161). `fsDeliveryExportOutput` gains `deliverAssets(assets)`: every image the brief resolved that is not already inside the assets folder the brief reads (`../assets` from `editaveis/`, otherwise `assets/` beside the brief, `deliveryAssetsFolder`) is copied there, a fetched one under ADR 0118's name. Nothing in that folder is removed or replaced: a same-named file with the same bytes is skipped in silence, one with other bytes is kept with `W_DELIVERY_ASSET_KEPT`. `recordingAssetResolver` and `DeliveredAsset` are back, to record what a run resolved.
- 4168183: The gallery on a disk (TYTO-503, ADR 0162). `fetchGalleryIndex` reads `index.yaml` from a repository's default branch with the person's `git` and keeps the copy fetched last in `TYTO_HOME/cache/gallery/`, read with `W_GALLERY_INDEX_OFFLINE` when a fetch fails. `readGalleryRecord` and `writeGalleryRecord` keep `plugin-files/gallery.json`, what the gallery wrote; `writeFileAtomically` writes beside a name and renames into place.

### Patch Changes

- Updated dependencies [fc3bee5]
- Updated dependencies [04233fc]
- Updated dependencies [6881557]
- Updated dependencies [4168183]
- Updated dependencies [4168183]
  - @tyto/core@0.35.0
  - @tyto/plugin-api@0.12.0
  - @tyto/template-lang@0.8.7
  - @tyto/pipeline@0.12.4
  - @tyto/export-html@0.7.8
  - @tyto/export-svg@2.0.8

## 5.0.0

### Major Changes

- 5494e98: `fsArtworkOutput(directory, { label? })` writes artwork into a folder and nothing beside it: no `result.json`, no copied brief, no `assets/` (TYTO-490, ADR 0157). It answers `Result<ReusableTaskOutput, Diagnostic[]>`, with `E_DELIVERY_FOLDER_BLOCKED` when a file holds the folder's name; its `removeLeftovers` removes nothing, because without a report no file is known to be Tyto's.

  **Breaking for `@tyto/io` callers:** `fsDeliveryOutput`, `DeliveryOutput` and `FsDeliveryOutputOptions` are removed, and nothing writes ADR 0057's `editaveis/` + `assets/` layout any more. Use `fsArtworkOutput` for a folder a person picked, or `fsTaskOutput` where a `result.json` belongs. The render contract's exit-code text now says `--folder` writes no `result.json`.

- cd14464: `fsDeliveryExportOutput({ artwork, report, label? })` writes a delivery's export (TYTO-490, ADR 0157 §6): the artwork into the delivery's `exports` folder, `result.json` and `template.txt` into its brief's folder. What its previous export wrote and this one did not is removed (ADR 0054). It answers `Result<DeliveryExportOutput, Diagnostic[]>`, with `E_DELIVERY_FOLDER_BLOCKED` when a file holds either folder.

  **Breaking for `@tyto/io` callers:** `recordingAssetResolver` and `DeliveredAsset` are removed. Nothing has copied a brief's images since part A of TYTO-490.

### Minor Changes

- 503f924: An installed plugin's code template reads files from its own folder (TYTO-478, ADR 0062). `context.files.image` and `context.files.svg` answer what the host read from the template's folder inside the installed plugin, and a declared image value's default resolves against the same folder; `tyto render` and the desktop embed those bytes in the export. **Breaking for plugins: the protocol is 12** (ADR 0149 point 4), because a template's `build` now carries a fourth argument, `ShippedFiles`, which a guest on 11 refuses. A path out of the folder, an absolute one or a file the host did not read answers `undefined`, and the folder's reader skips a link that leads out of it.
- eca9871: A template knows an image's width and height (TYTO-481, ADR 0158). `AssetRef` gains an optional `size: { w, h }`, read by the host off the header of a brief's image, a plugin-served image or a file in the template's own folder, and absent when no header parsed. `imageHeight(asset, width, fallback)` in `@tyto/template-kit` sizes a frame to it, so a frame follows the picture without a proportion written on the slide. **Breaking for plugins: the protocol is 13** (ADR 0149 point 4), because a guest on 12 refuses a ref that carries `size`.
- 0164874: `tyto delivery new <name> [--template <name>]` makes a delivery: one folder per piece of work, named after its ticket, with `assets/`, `editaveis/` and the brief as `editaveis/<name>.brief` (TYTO-489, ADR 0157). The project file and a work profile gain the `delivery` key (`parent`, `folders`, `brief`, `exports`, `formats`, `types`), merged one subkey at a time; `parent` stays inside the workspace folder for every sheet. An existing delivery folder is reused, an existing brief is refused with `E_DELIVERY_BRIEF_EXISTS` and nothing written, and a name a folder cannot have is `W_DELIVERY_NAME_INVALID` (ADR 0114's profile rule, up to 100 characters, NFC). `@tyto/core` now holds `briefSkeleton` and `skeletonText`, which `@tyto/editor` re-exports unchanged.

### Patch Changes

- 6ccfc2e: A plugin file pinned to an annotated tag locks the commit the tag points at, not the tag object (TYTO-472, ADR 0151). A lock an earlier version wrote with a tag object's id keeps loading and is rewritten to the commit on the next sync that can reach the repository; nothing is reported as a moved ref.
- 6d431f6: An installed plugin's code template can no longer make an export embed a file it was not handed (TYTO-479, ADR 0062). Before, a frame naming an image by an absolute `path`, or by an `id` leading out of the brief's folder, drew any image on the disk with no diagnostic. Every picture in such a frame must now be one the host sent that call — the template's own folder, or a ref in its context such as a slot's picture or a declared value — and any other costs the frame as the new `E_PLUGIN_TEMPLATE_ASSET`, naming the plugin, the template and the asset. The protocol stays 12.
- b40dea8: **File ▸ Delivery: New…** (`delivery.new`) makes a delivery in the open folder from the window (TYTO-489, ADR 0157): the command bar asks for its name, saying as you type why a name cannot be a folder's, then for a template or none; main makes the folder and the brief, which opens in a new tab and is selected in the Explorer, with the "/" menu when no template was chosen. A refusal is said in the status bar. A delivery a link inside the workspace would carry outside it is now `E_DELIVERY_PATH_OUTSIDE` instead of `W_PROJECT_PATH_OUTSIDE`, whose text is about an untrusted folder's key.
- Updated dependencies [503f924]
- Updated dependencies [6d431f6]
- Updated dependencies [eca9871]
- Updated dependencies [b7c5136]
- Updated dependencies [993b9f6]
- Updated dependencies [b40dea8]
- Updated dependencies [0164874]
- Updated dependencies [cd14464]
- Updated dependencies [0d828d3]
- Updated dependencies [0d828d3]
  - @tyto/plugin-api@0.11.0
  - @tyto/core@0.34.0
  - @tyto/export-html@0.7.7
  - @tyto/export-svg@2.0.7
  - @tyto/pipeline@0.12.3
  - @tyto/template-lang@0.8.6

## 4.3.1

### Patch Changes

- f612e26: TYTO-462: a plugin file's configuration applies only to the template its entry fetched. When a project folder template, the built-in pack or another plugin wins the name, the entry configures nothing (its aliases do not load, the bare name renders with the winner's own defaults) and `W_PLUGIN_FILE_TEMPLATE_SHADOWED` says so at the entry's name in the file. In `@tyto/core`, a `TemplateRoot` may carry an `origin`, answered by the registry's `originOf`, and a `ConfiguredTemplate` may carry the `plugin` it was fetched from and its `range`. In `@tyto/plugin-api`, a `PluginFileTemplate` carries its `range`. `@tyto/io` tags each configured template with the plugin whose copy fetched it, and leaves out one no copy fetched.
- Updated dependencies [f612e26]
- Updated dependencies [096f80e]
  - @tyto/core@0.33.0
  - @tyto/plugin-api@0.10.0
  - @tyto/export-html@0.7.6
  - @tyto/export-svg@2.0.6
  - @tyto/pipeline@0.12.2
  - @tyto/template-lang@0.8.5

## 4.3.0

### Minor Changes

- c590e01: TYTO-433: the desktop fetches the templates the plugin files name (ADR 0151). Main runs the sync `tyto render` runs when the app starts, when the window opens a workspace folder, and on Plugins: Sync Plugin Files and Plugins: Update Plugin Files (`plugin-files:sync`; the update moves every ref). The fetched copies run as a plugin set of their own, beside the installed plugins, started again when a sync changes which copies load; their template packs are searched after the built-in pack and before the installed ones, offer only the templates their files name, and leave out an installed plugin a copy replaces. A failed fetch is a row in the problems panel naming the repository, and the copy fetched before keeps loading; `templates:changed` tells the window to list and compile again. A permission prompt is a native box, recorded in `plugins.json` by name. A restricted folder's plugin files are neither fetched nor loaded, and are `W_PROJECT_PLUGIN_FILES_WITHHELD` in the trust strip's count. A fetched plugin contributes templates only in the window for now. `@tyto/io` adds `syncPluginFiles`, both folders' sync moved from the CLI, with the built-in names, the path display and the permission answer as parameters, plus `machinePluginFiles`, `projectPluginFiles` and `NO_PLUGIN_FILES`; the CLI composes it unchanged. `@tyto/core` adds `W_PROJECT_PLUGIN_FILES_WITHHELD`. A failed fetch or a refused commit is now printed by the CLI, and shown by the window, under the plugin file that named the source (`onSourceProblem` on `syncPluginFolder` and `syncPluginFiles`).
- e2b72a7: TYTO-456: `tyto plugin list [folder]` shows what the plugin files name, below the installed plugins: the plugin, machine or project, git, ref, the locked commit and whether a render loads it (`approved`, `not approved`, `not synced`, `refused`), then every alias as `alias → template (configuration)`. It reads the files, their lock, the cached copy's manifest and the approvals; it fetches nothing and runs no plugin. `--json` adds `pluginFiles` and `aliases`; `--active` keeps the approved copies. In a restricted workspace, `tyto render` and `tyto plugin list` name the project's `.tyto/plugin-files` as left out, in the words `tyto plugin sync` already used (ADR 0111). A plugin-file diagnostic about no file the run names (`W_PLUGIN_FILE_FETCH`, say) prints with no path instead of under the brief's name. `@tyto/core` exports `configurationAlias`, the `<template>-<configuration>` rule; `@tyto/io` exports `locationOf`. The manual's Plugins page describes the listing in both editions.

### Patch Changes

- Updated dependencies [c590e01]
- Updated dependencies [e7588e9]
- Updated dependencies [4388575]
- Updated dependencies [e2b72a7]
  - @tyto/core@0.32.0
  - @tyto/plugin-api@0.9.0
  - @tyto/export-html@0.7.5
  - @tyto/export-svg@2.0.5
  - @tyto/pipeline@0.12.1
  - @tyto/template-lang@0.8.4

## 4.2.0

### Minor Changes

- a5912e7: TYTO-439: plugin files resolve configurations and aliases (ADR 0151, ADR 0153). A configuration in `~/.tyto/plugin-files/*.yaml` or a trusted workspace's `.tyto/plugin-files/*.yaml` is reached by its alias — `<template>-<configuration>` when the file writes none — and the entry's `default` by the template's own name; every other configuration starts from the `default`. `tyto render` and `tyto watch` render an alias as its template with that configuration's values, the template's defaults under them and a caller's over them. A fetched pack offers only the templates its files name. `@tyto/core` adds `resolveTemplateConfigurations`, the `TemplateConfigurations` a `resolve` and a job look a name up in first, `ResolvedBrief.configuration` and `values`, `TemplateRoot` (`loadTemplateRegistry` takes a root that offers only some names) and `E_TEMPLATE_ALIAS_TAKEN`; each value is checked once, in the file that wrote it. `@tyto/plugin-api` keeps a range per configuration value, adds `configuredTemplates`, and carries `values` in a template call: **the isolation protocol is 10**, so a plugin process on 9 is refused at `hello`, and a manifest whose `engine` asks for `^0.7` is refused by this release's engine check until its range moves. `@tyto/io` adds `pluginFileImages`, which reads an image path relative to its file and keeps it inside the workspace or `TYTO_HOME`, `SyncedFolder.files` and `InstalledPacks.owners`. `@tyto/pipeline`'s `JobPorts` takes `configurations`.

### Patch Changes

- Updated dependencies [a5912e7]
  - @tyto/core@0.31.0
  - @tyto/plugin-api@0.8.0
  - @tyto/pipeline@0.12.0
  - @tyto/export-html@0.7.4
  - @tyto/export-svg@2.0.4
  - @tyto/template-lang@0.8.3

## 4.1.0

### Minor Changes

- 7115286: TYTO-432: the CLI fetches what the plugin files name (ADR 0151). `tyto plugin sync` reads `~/.tyto/plugin-files/*.yaml` and a trusted workspace's `.tyto/plugin-files/*.yaml`, fetches each source with the person's own `git` into `~/.tyto/cache/plugin-files/`, and pins the commit in `plugin-files.lock.json`; `--update` moves a branch, and nothing else does. `tyto render` runs the same sync without moving anything, so it reaches the network only for a copy that is missing, and loads each copy as an installed plugin. A source that cannot be reached loads the copy fetched before and says so. `tyto plugin clean` deletes the copies no lock names. `@tyto/plugin-api` gains the plugin-file parser and the lock's schema, `@tyto/io` the fetch, cache and lock adapters, and `@tyto/core` the `*_PLUGIN_FILE_*` diagnostic codes.

### Patch Changes

- Updated dependencies [7115286]
- Updated dependencies [46a0b89]
  - @tyto/core@0.30.0
  - @tyto/plugin-api@0.7.0
  - @tyto/export-html@0.7.3
  - @tyto/export-svg@2.0.3
  - @tyto/pipeline@0.11.2
  - @tyto/template-lang@0.8.2

## 4.0.1

### Patch Changes

- Updated dependencies [a558c12]
  - @tyto/plugin-api@0.6.0
  - @tyto/export-html@0.7.2
  - @tyto/export-svg@2.0.2
  - @tyto/pipeline@0.11.1

## 4.0.0

### Major Changes

- 93fcb8b: An artwork file another program holds open is now an internal failure worth retrying, not an error about the brief (TYTO-245, ADR 0108).

  **`ArtifactSink.write` returns `Promise<Diagnostics>`** (`@tyto/pipeline`), and so does `TaskOutput.write` (`@tyto/io`). A sink answers what it can explain — `E_OUTPUT_FILE_BLOCKED` for a folder at the artwork's name — and `runJob` fails that one frame with it and writes the others. A rejection is no longer turned into `E_OUTPUT_WRITE`: `runJob` starts no further frame, lets the ones in flight settle and rejects with the sink's cause. A sink of your own returns `[]` where it used to return nothing.

  `@tyto/core`: `E_OUTPUT_WRITE` is no longer produced and stays in the catalogue, documented as retired by ADR 0108. `E_OUTPUT_FILE_BLOCKED` is no longer fatal: on an artwork it costs that file, and the report that names it survives.

### Minor Changes

- c005b91: TYTO-270: a workspace's `.tyto/project.json`, or the work profile it names, can declare export presets (ADR 0126): `"exportPresets": { "entregas": { "formats": ["grid-1x1", "story"], "folder": "entregas" } }`, with `types` defaulting to `png` and `folder` to the project's `output`. Presets merge by name, profile then folder; a preset's `folder` resolves against the open workspace folder whichever sheet wrote it, and a restricted folder confines it there (`W_PROJECT_PATH_OUTSIDE`, the preset is dropped). A preset with no folder and no `output` is `W_PROJECT_PRESET_NO_FOLDER`. `core` resolves them into `ResolvedProject.exportPresets`; `@tyto/io` reads nested ranges and follows a preset's folder through `realpath`. The window lists each preset in the command bar as "Export: <name>" (`export.preset:<name>`, bindable in `keybindings.json`) and runs it through the export box, which opens already running and removes what the previous export left as before.
- 6abf89f: TYTO-278: a workspace folder's `.tyto/project.json` names its asset, template and font folders, its output folder and one section per plugin (ADR 0112). `core` resolves the file key by key from a list of sheets, so a work profile slots in later without a new signature, confines a restricted sheet's folders lexically and withholds its plugin sections (ADR 0111), and declares the `TrustStore` port. `@tyto/io` reads the file with ranges, follows every folder a restricted workspace names through `realpath` so a link inside that leads out is refused too, finds the workspace above a brief, never reads the folder whose `.tyto` is `TYTO_HOME`, and keeps approvals in `TYTO_HOME/trust.json` with `fsTrustStore`. `briefAssetResolver` takes the workspace's asset folders after the brief's own.
- 91efbbb: TYTO-280: `tyto render` and `tyto watch` draw images and fonts an installed plugin supplies (ADR 0117, ADR 0118). A `test:logo` image or a face no folder has is fetched once into `TYTO_HOME/cache/sources/`, and the next render asks nothing; a face that arrives makes the job compile once more, so its lines break against it. `tyto render` fetches for a trusted folder and for a brief in no folder; a restricted folder and `tyto watch` read the cache only, each miss saying why. A `--folder` delivery copies a fetched image under a name from its reference (`assets/logo.png`) and points the copied brief at it, so the delivery renders without the plugin. `@tyto/io`'s `sourceCache` takes the miss's reason as `notFetchedBecause`, and its delivery names fetched images that way.
- 017d381: TYTO-280: the window draws images and fonts an installed plugin supplies (ADR 0117, ADR 0119). The preview fetches what it lacks when the brief is saved or opened from disk, never while you type: a half-typed `test:lo` asks nobody, and the miss says to save. A face that arrives reaches the same preview, measured. The export box fetches too; the queue never does, and draws what a save already cached. A restricted folder fetches nothing and names Workspace: Manage Trust. A failed fetch is asked once per session, and the miss says a restart or a different reference asks again. `@tyto/io`'s `sourceCache` gains `remembersFailures` and a per-call `SourceCall`, and no longer remembers a miss it was not allowed to fetch.
- 53e01c3: TYTO-280: a plugin can supply images and fonts (ADR 0117). `@tyto/plugin-api` has two new extension points, `asset-source` (URI schemes such as `drive:`) and `font-source` (families), each with a `fetch` an installed plugin answers from its own process; the call carries the plugin's own section of the project file, absent when the folder withheld it. `@tyto/io`'s `sourceCache` asks them once and keeps the answer in `TYTO_HOME/cache/sources/<plugin>/`, named by a hash, so the next render asks nothing; a restricted folder reads the cache and fetches nothing. `@tyto/core`'s `AssetResolver` gains an optional `explain`, and a source's failure is `E_ASSET_SOURCE_FAILED` or `W_FONT_SOURCE_FAILED`. `@tyto/fonts`' library gains `refresh()`, and `@tyto/pipeline`'s `loadResources` may ask for one more compile once a fetched face arrives.
- 49db8d1: TYTO-347: the window shows the work profile an open folder names (ADR 0114). The trust strip has a line of its own for an untrusted profile that left something out, with **Trust this profile**, and a third button, **Show project**; Workspace: Manage Trust shows the profile with its own two buttons, none for a profile kept in `TYTO_HOME`. A profile's problems are listed in the problems panel with its file in front. Workspace: Show Project opens a read-only Project panel beside Problems listing `assets`, `templates`, `fonts` and `output`, each with its folders and `profile <name>`, `this folder` or `not set`. `workspace:trust` now takes a strict `source` (`folder` or `profile`) and still no path. `@tyto/io`'s `LoadedProfile` says whether it is trusted by where it lives (`byLocation`).
- 4aba89c: TYTO-347: a workspace's `.tyto/project.json` can name a work profile, a sheet many folders share (ADR 0114). `"profile": "saude"` reads `TYTO_HOME/profiles/saude/profile.json`, trusted by where it lives; a path names a profile file elsewhere, which is its own source in `trust.json` and is confined to its own folder until it is trusted. The profile's keys come first and the folder's win key by key. `core` reads the key with `profileReferenceOf`, refuses a restricted folder a profile path outside it, ignores a profile's own `profile` key (`W_PROFILE_NESTED`), and says in `ResolvedProject.origins` which sheet each value came from; `W_PROJECT_PROFILE_UNSUPPORTED` is replaced by `W_PROJECT_PROFILE_INVALID` and `W_PROJECT_PROFILE_MISSING`. `@tyto/io`'s `loadWorkspace` reads the profile with its own trust answer and follows its paths through `realpath`. `tyto render` uses it, prints a profile's problems against the profile's file, `--trust` covers the folder and its profile for the run, and `tyto trust remove` takes a profile file's approval back. The window resolves a folder's profile through the same loader; showing it is the next change.
- 3fa8604: TYTO-349: the command line can trust a workspace folder for good. `tyto trust add <folder>` prints what the folder does while restricted (a key that leads outside it, withheld plugin sections, its profile's problems), then writes the approval to `TYTO_HOME/trust.json` under the folder's real path, with no y/N prompt so a script can run it. It refuses a path that does not exist and the folder whose `.tyto` is `TYTO_HOME` (ADR 0112), accepts a folder with no project file, and says which `tyto trust add <file>` trusts the work profile the folder names. `tyto trust add <file>` trusts a shared profile file on its own (ADR 0114); one inside `TYTO_HOME` is already trusted by where it lives. `tyto trust list` prints each approval with its date and marks one whose path is gone. `fsTrustStore` in `@tyto/io` gains `list()`, off the core `TrustStore` port.
- 6511c41: TYTO-371 (ADR 0138): the CLI implements a plugin's private cache and its workspace files. `@tyto/io` adds `pluginCache({ home })`, which keeps each entry at `TYTO_HOME/cache/plugins/<plugin>/<sha256(key)>.bin` beside a `{ key, storedAt, size }` sidecar, both written atomically and dated by the host's clock, and `workspaceFiles({ folder, trust })`, which reads the folder and its trust on every call, refuses a restricted folder with `E_WORKSPACE_FILE_RESTRICTED`, confines a path again after `realpath`, refuses a write that lands in `.tyto/` through a link, and creates the folders a write needs. `workspaceDataResolver` now shares its containment check with it. `tyto render` gives plugins both, against the brief's workspace and its trust (`--trust` counting); a brief in no workspace answers that no folder is open. `tyto watch` gives the cache only, and its refusal names it.
- cfa70ff: TYTO-395 (ADR 0137): a recipe verb can read configuration from a JSON file beside the recipe, written `@./vocab.json#/kinds` (a JSON Pointer into the file) or `@./vocab.json` for the whole document. `@tyto/recipe` gains the optional `resolveData` port in `RunOptions` and `VerbContext` (passed on by `run`) and `readDataArgument`, which parses the reference, walks the pointer and checks the slice with the verb's Zod schema, reporting every refusal at the argument. `@tyto/io` gains `workspaceDataResolver`, which reads JSON with comments relative to the recipe's folder, confined to the workspace lexically and after `realpath`, refuses every file in a restricted workspace and caps a file at 1 MiB, and `readJsoncValue`. `@tyto/plugin-api` re-exports the `DataResolver` type. `@tyto/core` gains `E_RECIPE_DATA`, `E_RECIPE_DATA_RESTRICTED`, `E_RECIPE_DATA_SYNTAX` and `E_RECIPE_DATA_SHAPE`.
- c7cf84e: TYTO-401: `recipeStateStore({ home, workspace, recipe })` keeps a recipe's state between runs (ADR 0140) in `TYTO_HOME/state/recipes/<identity>/<store>.json`, where the identity is the SHA-256 of the workspace's real path and the recipe's path inside it. A store never written reads as empty; a corrupt or oversized one (over 32 MiB) is `E_RECIPE_STATE` naming the file, never an empty store. A write deletes, then merges each put over its key's values, stamps it with the host's clock and replaces the file atomically; this process's writes to one store take turns, and across processes the last writer wins. No host composes it yet.
- 885d0f5: TYTO-423 (ADR 0144): a recipe brings back the rows it remembered. `RecipeState`, which `@tyto/plugin-api` names, requires `entries(store)`: every entry a store holds, empty for a store never written and `E_RECIPE_STATE` for one that cannot be read. `recipeStateStore` implements it. `recall <store> [by=<column>] [mark=<column>]` appends one row per stored key the table lacks, after the table's rows and sorted by key, with the key (and the `by=` column) set and every other column null; `mark=` adds a boolean column true on the recalled rows. A recalled key that is already another row's key under `by=` is refused, and a host without state fails as `last` does. An expiry is a recipe pattern (stamp, `age`, `rules`, `remember … forget-when=`), documented in the ADR.

### Patch Changes

- 49c1569: TYTO-239: the comment on `fsInbox`'s ack retry says what it is still for — locks held from outside the desktop queue, which no longer races itself.
- e4255e4: TYTO-350: one JSONC reader for the project file and the settings file. `@tyto/io` exports `readJsoncText`, the reader `readProjectText` already used (parse, recovery around a syntax error, the range of every key and of every syntax error), now taking the file's own syntax code and its "not an object" problem. The desktop's `settings.json` is read through it and keeps its own in-place writer. Nothing a person sees changes: the same codes, messages and ranges as before.
- d247c20: TYTO-371 (ADR 0138): the desktop gives installed plugins a private cache and the open folder's files. `host.cache` keeps entries in the same `TYTO_HOME` the plugins live in, and `host.workspace` reads and writes the folder open in the window, asked at every call, so a folder opened or trusted while the plugin runs is the one it sees; refusals name `Tyto desktop`. The plugins screen says in words what `workspace:read` and `workspace:write` reach. In `@tyto/io` the cache's sidecar now carries the bytes' SHA-256 and `get` answers a miss when it disagrees, so two processes racing on one key with bytes of the same size never hand back one's bytes as the other's; a sidecar written before the digest is a miss and the next `put` replaces it. One host now writes an entry in turn, and the atomic write tries a rename again while Windows says the target is busy, which an export's frames putting one key at once used to hit as `EPERM`.
- Updated dependencies [d4a6939]
- Updated dependencies [08b936d]
- Updated dependencies [7342c02]
- Updated dependencies [15997e9]
- Updated dependencies [15997e9]
- Updated dependencies [93fcb8b]
- Updated dependencies [ea97dc3]
- Updated dependencies [3921252]
- Updated dependencies [c005b91]
- Updated dependencies [cbbf6df]
- Updated dependencies [2495d0d]
- Updated dependencies [6abf89f]
- Updated dependencies [53e01c3]
- Updated dependencies [ae75027]
- Updated dependencies [fe85505]
- Updated dependencies [5a0c7c5]
- Updated dependencies [bf3fd0e]
- Updated dependencies [8e9c9c4]
- Updated dependencies [ab9512e]
- Updated dependencies [d3df40e]
- Updated dependencies [4aba89c]
- Updated dependencies [58f54d6]
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
- Updated dependencies [e4ce1e8]
- Updated dependencies [fdcfda9]
- Updated dependencies [4186112]
- Updated dependencies [3da246d]
- Updated dependencies [885d0f5]
- Updated dependencies [3921252]
- Updated dependencies [ffd4770]
- Updated dependencies [431bf23]
  - @tyto/plugin-api@0.5.0
  - @tyto/core@0.29.0
  - @tyto/pipeline@0.11.0
  - @tyto/export-html@0.7.1
  - @tyto/export-svg@2.0.1
  - @tyto/template-lang@0.8.1

## 3.0.0

### Major Changes

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

### Patch Changes

- Updated dependencies [b20fe47]
- Updated dependencies [7dad141]
- Updated dependencies [4532332]
  - @tyto/core@0.28.0
  - @tyto/template-lang@0.8.0
  - @tyto/export-html@0.7.0
  - @tyto/export-svg@2.0.0
  - @tyto/pipeline@0.10.1
  - @tyto/plugin-api@0.4.1

## 2.0.0

### Major Changes

- 0937670: TYTO-204: an asset path in a brief is read as written, from the brief's folder first, and from `assets/` beside the brief when nothing is there (ADR 0056). The same rule holds in `tyto render`, `tyto watch`, the desktop queue, preview, export box and the template editor's preview, so a folder with its images in `assets/` renders the same in the CLI and in the app. `./assets/logo.png` now resolves everywhere, and when a file of the same name exists both beside the brief and in `assets/`, the one beside the brief wins. `tyto render --assets <dir>` still names the one folder searched, with no fallback. `E_ASSET_NOT_FOUND` now says it looked in `assets/` too.

  `@tyto/io` migration: `BriefTask.assetBase` is now `briefDirectory` (the brief's folder); resolve assets with `briefAssetResolver`.

### Minor Changes

- 8ca8eed: TYTO-205: a delivery carries its brief in `editaveis/` and the images the brief used in `assets/` (ADR 0057). The desktop export box now delivers into the picked folder — artwork at the top, `editaveis/`, `assets/` — and `tyto render --folder` gains `assets/` under its `<out>/<brief-name>/` level. The copied brief's image paths name the copies, and a brief in a folder named `editaveis` also reads `../assets`, so it renders again from where it sits. `E_ASSET_NOT_FOUND` names the folders actually searched.
- a84b756: TYTO-127: exporting again into a folder used before removes what the previous export wrote there and this one did not produce, and says so (ADR 0054). It applies to `tyto render --folder` and to the desktop's export box. `--out`, `tyto watch` and the queue panel are unchanged.

  A carousel edited from four slides down to three no longer delivers the fourth, and a delivery made before ADR 0053 loses its `lamina-*` files on the first export after the upgrade. Only a file the previous `result.json` listed can go, and only while its size is still the recorded one. A file somebody added or replaced by hand stays. Each removal is a `W_LEFTOVER_REMOVED` warning on stderr, in `result.json` and in the export box. A kept file is a `W_LEFTOVER_KEPT` with the reason, and a previous report that cannot be read is a `W_PREVIOUS_RESULT_UNREADABLE`.

  `@tyto/io`: `fsTaskOutput` takes `removeLeftovers` and, like `fsDeliveryOutput`, returns a `ReusableTaskOutput` whose `removeLeftovers(run)` is called before `finish`.

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

- 743910b: TYTO-216: `layeredExportResources` in `@tyto/io` puts several sources of export bytes together,
  the first that answers a ref winning, for `asset` and `assetSize`. `tyto render` binds the brief's
  files and the template's through it, in place of its own two copies. No output changes: the CLI's
  SVG for a `cover` image is byte-identical before and after, and to the window's.

### Patch Changes

- 8f58e18: TYTO-198: `fsInbox`'s `ack` tries the rename again while Windows says the task folder is held
  (`EPERM`, `EACCES`, `EBUSY`) — six attempts, 310 ms of waiting at most — and then fails as
  before. A file read inside the folder during the rename, by the queue's own listing or by an
  antivirus, no longer fails a task that rendered cleanly. `ENOENT` is never retried.
- 5f4c609: TYTO-214: `tyto render` and `tyto watch` hand a bundled code template the files in its own folder,
  through `context.files` (ADR 0062). Before, a code template could not draw a background kept beside
  its manifest. `fileTemplateAssets`
  now types its `assets` as `TemplateFiles`, which it always was.
- 8300c78: TYTO-214: a code template reads the files in its own folder through `context.files.image(path)`
  and `context.files.svg(path)` (ADR 0062). `TemplateContext` gains the required `files` field, and
  a context built by hand passes `noFiles`. `bundledTemplateSource` takes an optional
  `readFiles(directory)`; without it, a bundled template is handed no files, as before. An
  installed plugin's code template is handed `noFiles`.
- 525639b: TYTO-202: a template reports warnings beside its frame (ADR 0058). `TemplateContext` gains `report`, which takes one of a closed list of codes — the first is `W_TEMPLATE_OVERFLOW` — and `compile` writes the catalog's diagnostic with the artwork, the format and the range of the directive the artwork came from. An installed code template's reports cross back from its plugin's process beside the frame, as `ok({ frame, reports })`, checked against that list. `reportOverflow` in `@tyto/template-kit` reports content that runs past the page, and the weekly mock-exam agendas use it: a slide that runs off the grid now renders with a warning instead of being cut in silence. A context built by hand passes `reportNothing`.
- Updated dependencies [0937670]
- Updated dependencies [37fd201]
- Updated dependencies [7950dc3]
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
- Updated dependencies [eaf6ece]
- Updated dependencies [cd25d2d]
- Updated dependencies [5c0611f]
- Updated dependencies [82927c8]
- Updated dependencies [a69f493]
- Updated dependencies [64c75bb]
- Updated dependencies [b1b0745]
- Updated dependencies [091e2a2]
- Updated dependencies [e35546e]
- Updated dependencies [7659e7e]
- Updated dependencies [525639b]
- Updated dependencies [1ee0051]
  - @tyto/core@0.27.0
  - @tyto/plugin-api@0.4.0
  - @tyto/pipeline@0.10.0
  - @tyto/template-lang@0.7.0
  - @tyto/export-html@0.6.4
  - @tyto/export-svg@1.3.4

## 1.3.7

### Patch Changes

- Updated dependencies [17ad960]
  - @tyto/core@0.26.0
  - @tyto/template-lang@0.6.6
  - @tyto/export-html@0.6.3
  - @tyto/export-svg@1.3.3
  - @tyto/pipeline@0.9.1

## 1.3.6

### Patch Changes

- Updated dependencies [b587f0d]
  - @tyto/core@0.25.0
  - @tyto/pipeline@0.9.0
  - @tyto/export-html@0.6.2
  - @tyto/export-svg@1.3.2
  - @tyto/template-lang@0.6.5

## 1.3.5

### Patch Changes

- Updated dependencies [8b24969]
  - @tyto/core@0.24.0
  - @tyto/export-html@0.6.1
  - @tyto/export-svg@1.3.1
  - @tyto/pipeline@0.8.2
  - @tyto/template-lang@0.6.4

## 1.3.4

### Patch Changes

- Updated dependencies [80a03a8]
  - @tyto/core@0.23.0
  - @tyto/export-html@0.6.0
  - @tyto/export-svg@1.3.0
  - @tyto/pipeline@0.8.1
  - @tyto/template-lang@0.6.3

## 1.3.3

### Patch Changes

- Updated dependencies [353c83d]
  - @tyto/pipeline@0.8.0
  - @tyto/core@0.22.2
  - @tyto/export-html@0.5.5
  - @tyto/export-svg@1.2.3
  - @tyto/template-lang@0.6.2

## 1.3.2

### Patch Changes

- 91b6bc5: Dependency bumps in the prod group: `yaml` 2.9.0 → 2.9.1, `zod` 4.6.1 → 4.6.5, and
  `@codemirror/commands`, `@codemirror/state` and `@codemirror/view` to their latest patches.

  These are dependencies of what ships, so they get a patch and a line in the changelog rather
  than passing through unnamed. Written by hand because Dependabot cannot write a changeset — it
  has no idea this repository uses them — which is what makes every one of its PRs arrive red on
  `changeset status`. TYTO-155 is the card for fixing that properly.

- Updated dependencies [91b6bc5]
  - @tyto/core@0.22.1
  - @tyto/pipeline@0.7.2
  - @tyto/export-html@0.5.4
  - @tyto/export-svg@1.2.2
  - @tyto/template-lang@0.6.1

## 1.3.1

### Patch Changes

- @tyto/pipeline@0.7.1

## 1.3.0

### Minor Changes

- 38012ed: TYTO-121 — deliver an export as one folder: `fsDeliveryOutput`

  A second `TaskOutput` beside `fsTaskOutput`, for an export somebody sends to another person
  rather than to a program. It writes `<destination>/<name>/` with the artwork at the top and
  the brief and `result.json` underneath, in `editaveis/`:

  ```
  <destination>/<name>/
    <artwork>-<format>.png
    editaveis/
      <name>.brief
      template.txt
      result.json
  ```

  **`template.txt` names the template and never carries it.** `describeTemplate` writes the
  name, the version and the template's own description, plus a sentence saying the template
  lives in a repository and not in this folder. A copy per delivery would fill a remote with
  duplicates of a file that has one home and make "which version is the real one" a question;
  what a delivery owes its reader is the identity of the version that produced these exact
  files. It is a separate call rather than an option because the answer is not known when the
  output is opened — the run resolves it — and it goes in before `finish`, so `result.json`
  stays the last file to appear.

  **The top level holds artwork and nothing else, and that is the whole of the layout.** A
  folder with a report in it is a folder somebody tidies before sending it on, and the one file
  they would delete is the one file ADR 0011 says never to move. So it goes down a level, where
  a reader of `editaveis/` still finds it exactly where they expect. The brief goes down there
  with it, so a request to change a word two weeks later finds the text that made the images
  instead of a folder of pictures with no source.

  **Nothing about `--out` moved.** `fsTaskOutput` is unchanged and `tyto render --out <dir>`
  writes into exactly the directory named, which is what `docs/render-contract.md` publishes and
  what Jacurutu reads. The two adapters now share one copy of the writing — the atomic rename,
  the schema check, `result.json` last — because two copies would be two ways for a half-written
  PNG to reach a watcher.

  **The name is the caller's and is not sanitised**: it comes off a file that already exists on
  the filesystem, and a second sanitiser beside `artifactName`'s is how one folder ends up called
  two things. A name that is not a single path segment is **refused** rather than rewritten.

  **An existing folder is written into, not cleared** — the same rule `--out` has. What that
  costs is worth knowing: a brief edited from three slides down to two leaves the third one in
  the delivery, and `result.json` does not mention it, because it lists what that run wrote.

### Patch Changes

- Updated dependencies [801d292]
  - @tyto/pipeline@0.7.0

## 1.2.0

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
  - @tyto/template-lang@0.6.0
  - @tyto/pipeline@0.6.0
  - @tyto/export-html@0.5.3
  - @tyto/export-svg@1.2.1

## 1.1.0

### Minor Changes

- fce6186: TYTO-60 — export-svg emits geometry a design tool actually imports

  The SVG export was spec-correct and Chrome rendered it like the HTML export, but Figma's
  importer dropped three of the constructs it used — 21.00%, 49.69% and 12.11% of pixels
  differed from Chrome on the three fixtures. All three were instructions to a renderer where
  a shape would have done, so all three are now shapes (ADR 0023).

  What changes in the output:

  - **An image carries its own crop.** `<g clip-path><image transform="translate(…) scale(…)"
preserveAspectRatio="none"></g>` instead of a `preserveAspectRatio` that Figma ignores on
    an `<image>` and inside a `<pattern>` alike, stretching every `cover` photo to fill. A
    focal point is exact as a result, where it used to be snapped to one of nine alignments
    and reported.
  - **An inline SVG file is a scaled `<g>`, not a nested `<svg>`.** The viewport a nested
    `<svg>` establishes is not scaled on import, so a 24×24 mark on a 48×48 node arrived at
    24×24. The file is still handed over verbatim; the root's `xmlns:*` declarations move onto
    the `<g>` with its children.
  - **One `<text>` per line.** Positioned `<tspan>`s inside a single `<text>` collapse into one
    Figma layer, because a text layer there has one position. Every baseline was already an
    absolute number the exporter computed, so the picture is unchanged.

  `SvgResources.assetSize` is new and is where the crop's arithmetic gets the picture's own
  width and height — a port for the reason ADR 0018 gives bytes. `@tyto/io` answers it from
  the buffer it is already holding, reading the header of any PNG, JPEG, GIF, WebP, AVIF or
  SVG it embeds. Wired up by `fileResources` and `fileTemplateAssets`; a caller that supplies
  no `assetSize` gets the previous output, `preserveAspectRatio` and all, with no diagnostic —
  only a composition root can wire a port, so there is nobody to warn.

  Chrome fidelity was measured before and after, HTML export against SVG export, and improved
  rather than being traded: `promo.feed` 0.16% → 0.16%, `promo.story` 0.00% → 0.00%,
  `mapping.feed` 4.59% → 1.84%. Illustrator remains unverified.

### Patch Changes

- Updated dependencies [fce6186]
  - @tyto/export-svg@1.2.0
  - @tyto/pipeline@0.5.12

## 1.0.13

### Patch Changes

- Updated dependencies [4fad5b9]
  - @tyto/template-lang@0.5.0
  - @tyto/pipeline@0.5.12

## 1.0.12

### Patch Changes

- @tyto/pipeline@0.5.11

## 1.0.11

### Patch Changes

- Updated dependencies [2deabb8]
  - @tyto/template-lang@0.4.0
  - @tyto/pipeline@0.5.10

## 1.0.10

### Patch Changes

- Updated dependencies [8e6c2ef]
  - @tyto/template-lang@0.3.0
  - @tyto/pipeline@0.5.9

## 1.0.9

### Patch Changes

- Updated dependencies [ca8f122]
- Updated dependencies [2cea94a]
  - @tyto/core@0.21.1
  - @tyto/export-html@0.5.2
  - @tyto/export-svg@1.1.2
  - @tyto/pipeline@0.5.8
  - @tyto/template-lang@0.2.10

## 1.0.8

### Patch Changes

- Updated dependencies [2d5b5b8]
  - @tyto/pipeline@0.5.7

## 1.0.7

### Patch Changes

- @tyto/pipeline@0.5.6

## 1.0.6

### Patch Changes

- 9988e5d: The fonts Tyto ships become a package, so a render can reach them (ADR 0021).

  `@tyto/fonts` holds `fonts/<family>/` and the reader that hands the bytes to the exporters'
  `font` port as a `data:` URI and to `FontSource` as outlines. The faces used to sit at the
  repository root, where a package's `files` cannot reach, so no install ever had them and
  `tyto render` answered `E_EXPORT_FONT_UNRESOLVED` for every built-in template. `apps/cli`
  binds the resolver; `tools/test-fonts` is gone, promoted into this package.

  A `FontRef { source: 'file' }` is refused rather than matched by family name — a brief that
  points at its own font file must not be handed a bundled build of the same design.

  `@tyto/io`: `fileResources`' doc comment was describing a repository that bundled no font.
  No behaviour change.

## 1.0.5

### Patch Changes

- Updated dependencies [eb57af0]
  - @tyto/core@0.21.0
  - @tyto/export-html@0.5.1
  - @tyto/export-svg@1.1.1
  - @tyto/pipeline@0.5.5
  - @tyto/template-lang@0.2.9

## 1.0.4

### Patch Changes

- Updated dependencies [9b3ecd4]
  - @tyto/export-html@0.5.0
  - @tyto/export-svg@1.1.0
  - @tyto/core@0.20.0
  - @tyto/pipeline@0.5.4
  - @tyto/template-lang@0.2.8

## 1.0.3

### Patch Changes

- Updated dependencies [9b44b9d]
  - @tyto/core@0.19.0
  - @tyto/export-html@0.4.2
  - @tyto/export-svg@1.0.2
  - @tyto/pipeline@0.5.3
  - @tyto/template-lang@0.2.7

## 1.0.2

### Patch Changes

- Updated dependencies [4519c36]
  - @tyto/core@0.18.0
  - @tyto/export-html@0.4.1
  - @tyto/export-svg@1.0.1
  - @tyto/pipeline@0.5.2
  - @tyto/template-lang@0.2.6

## 1.0.1

### Patch Changes

- @tyto/pipeline@0.5.1

## 1.0.0

### Major Changes

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
  - @tyto/pipeline@0.5.0
  - @tyto/export-svg@1.0.0
  - @tyto/export-html@0.4.0
  - @tyto/template-lang@0.2.5

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
