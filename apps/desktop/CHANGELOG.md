# @tyto/desktop

## 0.14.2

### Patch Changes

- @tyto/templates@1.2.3
  - @tyto/command-line@0.2.2

## 0.14.1

### Patch Changes

- Updated dependencies [e94aa55]
  - @tyto/core@0.36.1
  - @tyto/brief-lang@0.7.8
  - @tyto/command-line@0.2.1
  - @tyto/editor@0.13.1
  - @tyto/export-html@0.7.10
  - @tyto/export-svg@2.0.10
  - @tyto/fonts@0.4.1
  - @tyto/google-fonts@0.1.9
  - @tyto/io@5.2.1
  - @tyto/pipeline@0.12.6
  - @tyto/plugin-api@0.13.1
  - @tyto/recipe@0.1.8
  - @tyto/template-lang@0.8.9
  - @tyto/templates@1.2.2
  - @tyto/theme-pack@0.1.9

## 0.14.0

### Minor Changes

- ded00d7: TYTO-504: Gallery: Browse Templates and Plugins shows the list the `galleryIndex` setting names, with each entry's preview and state, and installs or updates an entry with a click through the same operations as `tyto gallery`. A newer version is shown and waits for the click.
- 9517f15: **The bottom area is one strip of tabs, as in VS Code** (TYTO-496, ADR 0163): Problems, with its count, Commands, and Project or a plugin's panel when they are open, one shown at a time. The tab in front is remembered, the area keeps one height whichever tab is in front, and its × hides the whole area. The command panel has no input box any more: its prompt is the last line of its output, with nothing drawn around what is typed. Its sessions show as small tabs only when there is more than one, Stop shows only while something runs, and no line separates the panel's parts. Copy is gone from its actions: a selection copies.
- 24d6b47: **The command panel** (TYTO-496, ADR 0159): `tyto` commands typed into the window, in the bottom area beside Problems, opened and closed with `` Ctrl+` `` (Show or hide: Commands). Each session is a tab with one run, a Stop, and how the run ended: the exit code, or stopped. The input line splits on spaces and keeps a quoted word whole, refusing an unclosed quote; ↑/↓ walk the history and Ctrl+R searches it, kept per workspace folder. The output keeps a command's colours, links a place it printed to the file at that line, finds with Ctrl+F, copies and clears. After a `trust` command the window reads the folder's trust again. The keyboard and command references list the new key.
- 8dd4503: The command panel completes as you type (TYTO-496): commands, options and their values, read off the CLI's own tree, with the window's templates and aliases, the chosen template's formats, the output types, the installed plugins and the open folder's files. Tab takes a suggestion, the arrows choose and Enter takes the chosen one. **Commands: Run…** puts the caret on the prompt, and **Commands: Render This Brief** writes `render` and the brief in front on it. The user manual has a Commands page in both editions.
- 75cf37a: The command panel shows each run as a block (TYTO-496): a header with the command, its paths cut to file names, the time it started and how it ended (✓ 0, ✗ 1, stopped, not run), over what it printed, with a gap before the next. Problems' command sections take the same header. Two settings lay the runs out, live: `commandsOrder` (`"newestLast"`, the default, or `"newestFirst"`, which puts the prompt first; Problems' sections follow it) and `commandsFoldOlderRuns` (`false` by default; `true` folds every run but the newest to its header, a click opens one, and Ctrl+F opens a folded run that holds a match).
- 61dbfc1: The desktop app can run the person's shell in a terminal that main owns (TYTO-497, ADR 0164): PowerShell 7 or Windows PowerShell on Windows, the login shell elsewhere, or the program `terminalShell` and `terminalArgs` name in `settings.json`. A terminal starts in the open folder, or the home folder with none, and is refused while the open folder is restricted. It survives a change of folder and a reload of the window, which draws its last 256 KiB again, and ends with the app. The installers carry node-pty, the pseudo-terminal, with only the files each platform loads. No tab draws a terminal yet; the next pull request adds it.
- f0cd9b8: The desktop app has a Terminal tab after Commands (TYTO-497, ADR 0164): **Ctrl+Shift+`** or **Terminal: New Terminal** opens your own shell inside the window, in the open folder. Several terminals show as small tabs at the right of the strip. A terminal follows the window's colours, in light and dark, and its code font. Copy and paste follow each platform's terminal keys, a paste of more than one line asks first, and the window's own keys, such as **Ctrl+K**, still work from inside a terminal. A restricted folder says so in the tab, with the trust action beside it. Every push from main to the window now checks first that the window is still there, which ends a crash on quit. The user manual has a Terminal page in both editions.
- 9bcb68b: A built-in setting, `galleryIndex`, names the repository holding the gallery's index (TYTO-506, ADR 0162). Its default is the index the project curates, the same one `tyto gallery` falls back to; the window's gallery reads it.
- ff3461b: Each workspace folder keeps its open tabs, unsaved text included, and opening the folder again from File ▸ Open Folder or the recent list brings them back (TYTO-513, ADR 0165).
- 555e319: The menu bar names Tyto's own work (TYTO-514, ADR 0166): File, Edit, Brief, Preview, View, Tools,
  Window and Help. Brief holds format, the "/" menu, go to block, export and the template verbs;
  Preview its slides, formats, zoom and lock; Tools the gallery, plugins, queue, a new terminal,
  the person's JSON files and the folder's trust. View gains Show Problems, Commands and Show
  Terminal, and the vim mode. Every item runs a registry command; none carries a key.

### Patch Changes

- 546f99f: TYTO-410: rename local names that shadow an import or an outer name in the desktop app, without changing behavior, and enforce the no-shadow lint rule there too.
- 280761a: The status bar's problem count includes the rows a `tyto` command run in the window reported, and its errors count as errors. A command's place in a Problems row reads relative to the open folder, takes at most half of the row, and is cut from the start of its folder, so the file and its line always show. The command panel's parts arrive ahead of it, unused until TYTO-496's panel lands: the command line split into words, a command's colours, the history per folder, the links in its output, and its sessions.
- 0bf1b88: TYTO-510: the packaged app carries node-pty's own prebuilt binaries on Windows and macOS instead of compiling them, so packaging there needs no C++ toolchain; macOS's spawn-helper is made executable when packing.
- Updated dependencies [213f553]
- Updated dependencies [213f553]
- Updated dependencies [9021b50]
- Updated dependencies [8dd4503]
- Updated dependencies [f0cd9b8]
- Updated dependencies [93fb9c9]
- Updated dependencies [147eafa]
- Updated dependencies [bd56ec5]
- Updated dependencies [9bcb68b]
- Updated dependencies [05c9f83]
  - @tyto/command-line@0.2.0
  - @tyto/io@5.2.0
  - @tyto/core@0.36.0
  - @tyto/editor@0.13.0
  - @tyto/pipeline@0.12.5
  - @tyto/plugin-api@0.13.0
  - @tyto/recipe@0.1.7
  - @tyto/template-lang@0.8.8
  - @tyto/export-html@0.7.9
  - @tyto/export-svg@2.0.9
  - @tyto/brief-lang@0.7.7
  - @tyto/fonts@0.4.1
  - @tyto/google-fonts@0.1.8
  - @tyto/templates@1.2.1
  - @tyto/theme-pack@0.1.8

## 0.13.0

### Minor Changes

- 787c4ce: What a `tyto` command run in the window reports appears in the Problems panel: one section per run, under the command it ran, below the brief's own rows, for the last five runs. Each row shows the file and line the command printed. A row in a file a tab opens is a button, and main opens that file by run and row, never by a path the window names. A `render --types png` run from the window rasters through the export's own rasterizer. The panel to run commands from is TYTO-496.
- a5a896a: Main runs `tyto` commands for the window (TYTO-495, ADR 0159). New channels: `cli:run` takes the words after `tyto` and answers with a run id, `cli:cancel` stops a run, and `cli:commands` describes the command tree. New events: `cli:output` carries the text, and `cli:state` carries running, waiting, finished with its exit code, or cancelled. A command uses the window's rasterizer, plugin launcher, `TYTO_HOME` and open folder. It asks its questions in a native box whose default is no. Three things are refused: `--trust`, an npm `plugin install` on Windows, and `watch` on the auto-run queue's folder. No panel shows any of this yet; TYTO-496 adds one.
- 6881557: Exporting a delivery from its brief's tab now also copies the images the brief uses from outside the delivery's `assets/` into it (TYTO-499, ADR 0161). Nothing there is removed or replaced; a different file of the same name is kept, and the Export dialog lists `W_DELIVERY_ASSET_KEPT` for it.

### Patch Changes

- fc3bee5: The app and `tyto` come with `banner-teste` instead of `banner-roxo` (TYTO-436): the production banner is fetched from `tyto-template-banner` by a plugin file. The tests that drew `banner-roxo` draw `banner-teste`, and the manual's deliveries page starts its brief from `carrossel-lista`.
- cd5e075: Tests only: the font fixtures four suites read moved with the CLI's command tree into `@tyto/command-line` (TYTO-495). Nothing in the app changes.
- Updated dependencies [fc3bee5]
- Updated dependencies [fc3bee5]
- Updated dependencies [04233fc]
- Updated dependencies [cd5e075]
- Updated dependencies [787c4ce]
- Updated dependencies [a5a896a]
- Updated dependencies [6881557]
- Updated dependencies [6881557]
- Updated dependencies [4168183]
- Updated dependencies [4168183]
- Updated dependencies [4168183]
- Updated dependencies [4168183]
  - @tyto/templates@1.2.0
  - @tyto/brief-lang@0.7.6
  - @tyto/core@0.35.0
  - @tyto/editor@0.12.1
  - @tyto/fonts@0.4.1
  - @tyto/plugin-api@0.12.0
  - @tyto/template-lang@0.8.7
  - @tyto/command-line@0.1.0
  - @tyto/io@5.1.0
  - @tyto/pipeline@0.12.4
  - @tyto/export-html@0.7.8
  - @tyto/export-svg@2.0.8
  - @tyto/google-fonts@0.1.7
  - @tyto/recipe@0.1.6
  - @tyto/theme-pack@0.1.7

## 0.12.0

### Minor Changes

- 35b8ea7: Recent project folders in the title bar (TYTO-487). A button after Help names the open folder and opens a popover of the folders opened before, newest first: type to filter, arrows and Enter to open, Escape to close, and Open Local Folder… at the foot. A folder chosen there opens through File ▸ Open Folder's own door, with the same trust rules (ADR 0111) and one folder per window (ADR 0113). The command `workspace.openRecent` opens the same popover and can be bound in `keybindings.json`. Main keeps the last ten folders in `recent-folders.json` beside the recent files and hands the window ids, never paths.
- b40dea8: **File ▸ Delivery: New…** (`delivery.new`) makes a delivery in the open folder from the window (TYTO-489, ADR 0157): the command bar asks for its name, saying as you type why a name cannot be a folder's, then for a template or none; main makes the folder and the brief, which opens in a new tab and is selected in the Explorer, with the "/" menu when no template was chosen. A refusal is said in the status bar. A delivery a link inside the workspace would carry outside it is now `E_DELIVERY_PATH_OUTSIDE` instead of `W_PROJECT_PATH_OUTSIDE`, whose text is about an untrusted folder's key.
- 5494e98: The export box and the export presets write only the artwork into the folder you pick: no `result.json`, no `editaveis/` with the brief, no `assets/` with its images (TYTO-490, ADR 0157). The dialog is the run's report. A file an earlier export wrote and this one did not produce now stays in the folder, and the leftovers list no longer appears. To keep the brief and its images beside the artwork, make a delivery (**File ▸ Delivery: New…**). The queue is unchanged.
- cd14464: A button beside **Open preview to the side** exports the delivery the brief in front belongs to, with no dialog to fill (TYTO-490, ADR 0157 §6). The export box opens already running. The artwork goes to the delivery's root (its `exports` folder), and `result.json` and `template.txt` go beside the brief. For a brief in no delivery the button is greyed, with a tooltip saying why. The command is **Delivery: Export** (`delivery.export`), bindable in `keybindings.json`.

### Patch Changes

- d7c61ea: The app and `tyto` come with the test templates only (TYTO-436): `banner-roxo`, `carrossel-lista` and `promo-curso`. The house's production templates are fetched from their own repositories by a plugin file, which the manual's template gallery points to; without one, they are not listed. The tests that drew a removed template draw a remaining one.
- 503f924: An installed plugin's code template reads files from its own folder (TYTO-478, ADR 0062). `context.files.image` and `context.files.svg` answer what the host read from the template's folder inside the installed plugin, and a declared image value's default resolves against the same folder; `tyto render` and the desktop embed those bytes in the export. **Breaking for plugins: the protocol is 12** (ADR 0149 point 4), because a template's `build` now carries a fourth argument, `ShippedFiles`, which a guest on 11 refuses. A path out of the folder, an absolute one or a file the host did not read answers `undefined`, and the folder's reader skips a link that leads out of it.
- 6d431f6: An installed plugin's code template can no longer make an export embed a file it was not handed (TYTO-479, ADR 0062). Before, a frame naming an image by an absolute `path`, or by an `id` leading out of the brief's folder, drew any image on the disk with no diagnostic. Every picture in such a frame must now be one the host sent that call — the template's own folder, or a ref in its context such as a slot's picture or a declared value — and any other costs the frame as the new `E_PLUGIN_TEMPLATE_ASSET`, naming the plugin, the template and the asset. The protocol stays 12.
- Updated dependencies [d7c61ea]
- Updated dependencies [6ccfc2e]
- Updated dependencies [503f924]
- Updated dependencies [6d431f6]
- Updated dependencies [eca9871]
- Updated dependencies [b7c5136]
- Updated dependencies [993b9f6]
- Updated dependencies [b40dea8]
- Updated dependencies [0164874]
- Updated dependencies [5494e98]
- Updated dependencies [cd14464]
- Updated dependencies [cd14464]
- Updated dependencies [0d828d3]
- Updated dependencies [0d828d3]
  - @tyto/templates@1.1.0
  - @tyto/io@5.0.0
  - @tyto/plugin-api@0.11.0
  - @tyto/core@0.34.0
  - @tyto/editor@0.12.0
  - @tyto/export-html@0.7.7
  - @tyto/export-svg@2.0.7
  - @tyto/google-fonts@0.1.6
  - @tyto/pipeline@0.12.3
  - @tyto/theme-pack@0.1.6
  - @tyto/brief-lang@0.7.5
  - @tyto/fonts@0.4.0
  - @tyto/recipe@0.1.5
  - @tyto/template-lang@0.8.6

## 0.11.0

### Minor Changes

- 4a1455e: TYTO-467: "New brief from template…" and the "/" menu say when a name is an alias. The row's line reads what it stands for, `aviso · laranja` (in the "/" menu, before what choosing it does), and the plugin file that declares it is on hover in the bar and in the panel CodeMirror opens beside the highlighted "/" row. `templates:list`'s `alias` carries that `file`. In `@tyto/editor`, a `SlashItem` may carry `info`, passed to the completion as CodeMirror's own. A template that is not an alias shows as before.
- 835edfd: A plugin file's configuration that names a brand no started plugin's kit offers is now a `W_BRAND_KIT_MISSING` row in the problems panel, placed at its `brand:` line, as `tyto render` already says it (TYTO-471, ADR 0155). It is said once the installed plugins have started, and again after every sync of the plugin files.

### Patch Changes

- f612e26: TYTO-462: a plugin file's configuration applies only to the template its entry fetched. When a project folder template, the built-in pack or another plugin wins the name, the entry configures nothing (its aliases do not load, the bare name renders with the winner's own defaults) and `W_PLUGIN_FILE_TEMPLATE_SHADOWED` says so at the entry's name in the file. In `@tyto/core`, a `TemplateRoot` may carry an `origin`, answered by the registry's `originOf`, and a `ConfiguredTemplate` may carry the `plugin` it was fetched from and its `range`. In `@tyto/plugin-api`, a `PluginFileTemplate` carries its `range`. `@tyto/io` tags each configured template with the plugin whose copy fetched it, and leaves out one no copy fetched.
- 096f80e: A plugin file's configuration may restrict its formats with `formats:` beside `brand:` (TYTO-475, ADR 0155 decision 6). A brief, a run's `--formats` or the Export dialog asking that configuration for another format gets `E_UNKNOWN_FORMAT` under the name the brief wrote, with a hint naming the configuration; a configuration without one takes its entry `default`'s. A format the template does not render, a list with nothing left, or a `brief.formats` default outside the restriction is the new `W_CONFIGURATION_FORMATS_INVALID`. The desktop's template list offers a restricted configuration only its formats.
- Updated dependencies [f612e26]
- Updated dependencies [4a1455e]
- Updated dependencies [096f80e]
  - @tyto/core@0.33.0
  - @tyto/plugin-api@0.10.0
  - @tyto/io@4.3.1
  - @tyto/editor@0.11.0
  - @tyto/brief-lang@0.7.4
  - @tyto/export-html@0.7.6
  - @tyto/export-svg@2.0.6
  - @tyto/fonts@0.4.0
  - @tyto/google-fonts@0.1.5
  - @tyto/pipeline@0.12.2
  - @tyto/recipe@0.1.4
  - @tyto/template-lang@0.8.5
  - @tyto/templates@1.0.7
  - @tyto/theme-pack@0.1.5

## 0.10.0

### Minor Changes

- fbabe97: TYTO-433: the desktop resolves the plugin files' configurations and aliases (ADR 0151). A brief that names an alias previews and exports as its template with that configuration's values, as `tyto render` does; an alias named like a template that loaded is refused with `E_TEMPLATE_ALIAS_TAKEN` at its place in the plugin file. `templates:list` lists each alias as a row of its own, carrying `alias: { template, configuration }`, so the template picker, the "/" menu and "New brief from template" offer it. A sync that only edited a plugin file tells the window too. The permission box is `approveInABox`, a function around Electron's dialog.
- c590e01: TYTO-433: the desktop fetches the templates the plugin files name (ADR 0151). Main runs the sync `tyto render` runs when the app starts, when the window opens a workspace folder, and on Plugins: Sync Plugin Files and Plugins: Update Plugin Files (`plugin-files:sync`; the update moves every ref). The fetched copies run as a plugin set of their own, beside the installed plugins, started again when a sync changes which copies load; their template packs are searched after the built-in pack and before the installed ones, offer only the templates their files name, and leave out an installed plugin a copy replaces. A failed fetch is a row in the problems panel naming the repository, and the copy fetched before keeps loading; `templates:changed` tells the window to list and compile again. A permission prompt is a native box, recorded in `plugins.json` by name. A restricted folder's plugin files are neither fetched nor loaded, and are `W_PROJECT_PLUGIN_FILES_WITHHELD` in the trust strip's count. A fetched plugin contributes templates only in the window for now. `@tyto/io` adds `syncPluginFiles`, both folders' sync moved from the CLI, with the built-in names, the path display and the permission answer as parameters, plus `machinePluginFiles`, `projectPluginFiles` and `NO_PLUGIN_FILES`; the CLI composes it unchanged. `@tyto/core` adds `W_PROJECT_PLUGIN_FILES_WITHHELD`. A failed fetch or a refused commit is now printed by the CLI, and shown by the window, under the plugin file that named the source (`onSourceProblem` on `syncPluginFolder` and `syncPluginFiles`).
- 303c2dc: TYTO-440: the desktop's New brief from template and "/" menu write what a plugin file's configuration says about a new brief. `templates:list` rows carry `configured` (the configuration's `skeleton`, `formats` and the slots it fills) for the template's own name and each alias. `@tyto/editor`'s `briefSkeleton` takes it as `SkeletonManifest.configured`: a configured skeleton is written whole, its `template:` line naming the row picked; without one, the computed skeleton uses the configured formats and leaves out the filled slots. The window shows `W_SLOT_OVER_CONFIGURED_LIMIT` like any other warning. The manual's Plugins page says so in both editions.

### Patch Changes

- Updated dependencies [c590e01]
- Updated dependencies [e7588e9]
- Updated dependencies [303c2dc]
- Updated dependencies [4388575]
- Updated dependencies [e2b72a7]
  - @tyto/core@0.32.0
  - @tyto/io@4.3.0
  - @tyto/plugin-api@0.9.0
  - @tyto/editor@0.10.0
  - @tyto/templates@1.0.6
  - @tyto/brief-lang@0.7.3
  - @tyto/export-html@0.7.5
  - @tyto/export-svg@2.0.5
  - @tyto/fonts@0.4.0
  - @tyto/google-fonts@0.1.4
  - @tyto/pipeline@0.12.1
  - @tyto/recipe@0.1.3
  - @tyto/template-lang@0.8.4
  - @tyto/theme-pack@0.1.4

## 0.9.3

### Patch Changes

- Updated dependencies [a5912e7]
  - @tyto/core@0.31.0
  - @tyto/plugin-api@0.8.0
  - @tyto/io@4.2.0
  - @tyto/pipeline@0.12.0
  - @tyto/brief-lang@0.7.2
  - @tyto/editor@0.9.2
  - @tyto/export-html@0.7.4
  - @tyto/export-svg@2.0.4
  - @tyto/fonts@0.4.0
  - @tyto/google-fonts@0.1.3
  - @tyto/recipe@0.1.2
  - @tyto/template-lang@0.8.3
  - @tyto/templates@1.0.5
  - @tyto/theme-pack@0.1.3

## 0.9.2

### Patch Changes

- Updated dependencies [7115286]
- Updated dependencies [46a0b89]
  - @tyto/core@0.30.0
  - @tyto/io@4.1.0
  - @tyto/plugin-api@0.7.0
  - @tyto/templates@1.0.4
  - @tyto/brief-lang@0.7.1
  - @tyto/editor@0.9.1
  - @tyto/export-html@0.7.3
  - @tyto/export-svg@2.0.3
  - @tyto/fonts@0.4.0
  - @tyto/google-fonts@0.1.2
  - @tyto/pipeline@0.11.2
  - @tyto/recipe@0.1.1
  - @tyto/template-lang@0.8.2
  - @tyto/theme-pack@0.1.2

## 0.9.1

### Patch Changes

- Updated dependencies [8ece763]
  - @tyto/templates@1.0.3

## 0.9.0

### Minor Changes

- dcd1757: A recipe opens as a notebook: under each cell, its table (20 rows, then how many more), when it ran and how old its data is, a fold toggle, **Run from here** and, on a cell that fetches, **Fetch again**. Two commands do the same from the keyboard, Run recipe from this cell and Run recipe, fetching again. `@tyto/editor` gains `remeasureCellOutput`, for an output whose height changed in place.
- 8b06696: A `.recipe` file opens in a tab of its own: in the recipe colours, with the verbs offered at the start of a line, run on a pause in typing, on save and by Run recipe, with one line under each cell and its problems in Problems. A `run x` whose recipe holds a source no longer fetches while typing, and editing an included recipe on disk reruns the cell that includes it.

### Patch Changes

- a558c12: A source's `page` request carries `refresh: true` on a run without cache, so the source skips its private cache and fetches; an ordinary run carries no key. The isolation protocol moves to 9, so a plugin process on 8 is refused at `hello`. The desktop's recipe notebook hands the flag on when a run is asked to start fresh.
- Updated dependencies [dcd1757]
- Updated dependencies [a558c12]
  - @tyto/editor@0.9.0
  - @tyto/plugin-api@0.6.0
  - @tyto/export-html@0.7.2
  - @tyto/export-svg@2.0.2
  - @tyto/google-fonts@0.1.1
  - @tyto/io@4.0.1
  - @tyto/pipeline@0.11.1
  - @tyto/theme-pack@0.1.1

## 0.8.0

### Minor Changes

- b3532e3: TYTO-113: the window reopens where the person left it — the same tabs, in the same order, with the same one in front, and the text typed and not saved still in them. Quitting with unsaved work asks nothing any more; the drafts are kept in the app's own data folder and come back on the next launch. A file that changed on disk while the app was closed opens with the disk's text and the draft in a new tab beside it; a file that is gone is named in the problems panel. Reload is back on the View menu and on Ctrl+R, and brings every tab back. The undo history does not survive a restart.
- 814f236: TYTO-143 (ADR 0076): the status bar's problems button carries a small accent dot beside the count when the window raised a problem of its own — a save that failed, a recent file that is gone, a template folder with no templates — while the problems panel was not on screen (closed, or inside a hidden bottom area). Showing the panel clears it; compiler diagnostics from typing never light it. Changing the template folder no longer drops a live failed-save or missing-file row from the panel.
- d4a6939: TYTO-206 (ADR 0073): `settings.json` becomes a JSON-with-comments file the person owns. `plugin-api` gains the `configuration` extension point (`registerConfiguration`, `registry.configurations()`, `InProcessHost.configure`, `resolveSettings`), and the desktop app's four settings are declared through it by a built-in `desktop` plugin, under their existing names. Reading is tolerant one key at a time; a bad value costs that key alone and is a diagnostic with a range (`E_SETTINGS_SYNTAX`, `W_SETTING_UNKNOWN`, `W_SETTING_UNPREFIXED`, `W_SETTING_INVALID`, new in `core`). The app's screens edit the file in place, keeping comments and writing only keys that differ from their defaults, and never write a file that does not parse. The previous-version import accepts a commented `settings.json`.
- c141ec9: TYTO-206, PR B: "Preferences: Open Settings (JSON)" opens `settings.json` in a tab. Its problems
  show in the problems panel while you type, a save from the tab or any editor applies with no
  restart, and a screen's change goes into the tab's unsaved buffer instead of the disk. A screen's
  change to a file that does not parse is refused, undone and shown. `@tyto/editor`'s `blank`
  takes an optional language for one document, without the host's language extensions.
- 08b936d: TYTO-207, PR B: "Preferences: Open Keyboard Shortcuts (JSON)" opens `keybindings.json` (beside
  `settings.json`) in a tab, from the command bar or the File menu. Each entry is
  `{ "key", "command", "when"? }`, and `"command": "-<id>"` removes a default binding. A save from
  the tab or any editor applies with no restart, and the command bar shows the key that now works.
  Unknown commands, invalid keys, unknown contexts, duplicates and attempts to take Ctrl+K away
  show in the problems panel at their line while you type. A file that does not parse changes
  nothing: the keys it last bound stay.
- 7342c02: TYTO-207 (ADR 0074): every key the window answers now comes from one keybinding table. `@tyto/editor` gains a pure resolver (`parseKey`, `resolveKeybindings`, `keymapSetFor`, `windowBindingsOf`, `shownBindingsOf`) over six closed contexts, `vimMode` and `createEditor` take their vim set as an option, and `setKeymaps` swaps both modes' bindings in place. `plugin-api`'s `editor.keymap` gains an optional `when` and is consumed by the desktop for the first time. `core` gains six codes (`E_KEYBINDINGS_SYNTAX`, `W_KEYBINDING_UNKNOWN_COMMAND`, `W_KEYBINDING_INVALID_KEY`, `W_KEYBINDING_UNKNOWN_CONTEXT`, `W_KEYBINDING_DUPLICATE`, `W_KEYBINDING_LOCKED`). The desktop's `Mod-K` listener becomes a window dispatcher for global keys, registered once. No default key changes.
- 15997e9: TYTO-208 (ADR 0077): the window's colours arrive as a theme. The built-in `desktop` plugin registers Tyto Light and Tyto Dark through the `theme` point; main reads and checks them and answers `theme:current`, and the window applies them over `tokens.css`, which stays the first paint and the fallback. Nothing on screen changes: the two files equal the token file, which a test enforces. The shadows' colours become two themed tints.
- 0aad8b7: TYTO-208 (ADR 0077): a person chooses the colour theme. The new `theme` setting is one theme id or `{ mode: "system" | "light" | "dark", light, dark }`; `mode: "light"` or `"dark"` overrides the system for the window, the editor and the native dialogs, and a save of `settings.json` applies it with no restart. "Preferences: Color Theme" in Ctrl+K lists every theme with its kind, previews the highlighted one, writes the choice on Enter and puts the previous theme back on Escape. Installed plugins' themes are read from their folders and can be chosen; a theme file that cannot be used is a row in the problems panel, and the built-in theme of its kind applies.
- 18ee1d3: TYTO-244 (ADR 0078): on Windows and Linux the title bar carries the menu again — File, Edit, View, Window and Help in a row, each opening the system's own list of that menu, so Help ▸ Open the log folder and Help ▸ About are reachable again. Alt pressed alone or F10 moves focus to the row; Left and Right move between names, Enter or Down opens one, Escape goes back to the editor. The lists themselves are the system's and do not follow the colour theme. The line under the title bar now runs under the minimise, maximise and close buttons too. macOS is unchanged.
- ee73d63: TYTO-244 (ADR 0078): on Windows and Linux the window draws its own title bar — "Tyto — <file>" for the tab in front, "Tyto" alone for an untitled one — in place of the system's title bar and the old header with the tagline, which is gone. The minimise, maximise and close buttons stay the system's, drawn over the bar's right end in the colours of the applied theme, and they follow a theme change, the picker's preview and the system's light/dark switch. macOS keeps its native frame. Until the drawn menu row lands, the File/Edit/View/Window/Help menu bar is not shown on Windows and Linux.
- b713378: TYTO-247: a `.md` tab is coloured as Markdown, and "Open preview to the side" shows it formatted beside its text, following typing and following another `.md` brought to the front. Images show their description only, links are not followed and HTML in the file shows as text. File ▸ "Open a brief…" is now "Open…", and the status bar draws no Export button with a text file in front.
- 52d0867: TYTO-247: the window opens and edits `.txt` and `.md` files in a tab. A click or Enter on one in the Explorer opens it, a new one made there opens too, and File ▸ Open offers "Text files" and "All supported files" after "Brief". A text tab is plain text: no preview, no export and no export presets; the status bar says "Plain text" or "Markdown", and Problems says text files are not checked. Saving, the unsaved dot and hot exit work as for a brief, and Save As offers the tab's own extension.
- 752ddd2: TYTO-248 (ADR 0076): the foot of the window is a one-line status bar. Left: buttons for the left area and the command bar, and vim's mode and pending keys while vim is on. Right: line and column with the selection size, the tab's kind, the brief's template, a problems button holding the count, queue, plugins, export, settings, the bottom and right area buttons, and the update notice. The area buttons hide and show a whole area through the new `layout.toggleDock:left|bottom|right` commands, and a hidden area is remembered in `layout.json`. The version, the platform, the template count and the template folder moved to Help ▸ About; the language picker left the window, and the language is switched from the command bar.
- ea97dc3: TYTO-254 (ADR 0145): an installed plugin's settings work in the desktop. `settings.json` is checked against the built-ins' settings and the installed plugins' together, so `<plugin>.<key>` is suggested in the settings tab, checked with a ranged `W_SETTING_INVALID`, and delivered to the plugin's process: the window's plugin host is configured on every reading, and each export's host before the installed plugins are activated into it. The tab's validation, its outline and the launch log wait for the installed plugins to start, and the file is read again then. A key of an installed plugin that is disabled, failed or refused is the new warning `W_SETTING_PLUGIN_NOT_RUNNING`, which names the plugin, instead of `W_SETTING_UNKNOWN`.
- 0dd0e56: TYTO-256: the settings and keybindings tabs read as what they are. A misspelt key or an unknown command is underlined in the editor, as a brief's mistakes are; the editor heading says "Settings" or "Keybindings"; the template picker, the format tabs, the slide and the zoom are gone from those tabs, and the preview says the file applies when it is saved. Choosing a template while `settings.json` was in front used to write a YAML block into the JSON; it no longer edits the file.
- 6e2e350: TYTO-264: on Windows and Linux, Alt and a menu's letter opens that menu from the title bar: Alt+F opens File, Alt+E Edit, Alt+V View, Alt+W Window and Alt+H Help, and in Portuguese Alt+A Arquivo, Alt+E Editar, Alt+X Exibir, Alt+J Janela and Alt+D Ajuda. Holding Alt underlines each name's letter. The five menu names now follow the window's language; before, only File did, and Edit, View, Window and Help stayed in English. A key the editor uses, such as Alt+L to select the line, still goes to the editor. A shortcut a person or a plugin put on Alt and a letter takes that letter from the menus. macOS is unchanged.
- 99f185d: TYTO-265: after a quit or a reload, each tab comes back with its cursor where it was and scrolled to the same place, not at line 1. A file that got shorter on disk while the app was closed puts the cursor at the end of what is there. The undo history still starts empty.
- ee61cf6: TYTO-266: the template mode is kept on quit like the tabs are. Quitting with unsaved changes to a template's `manifest.yaml` or `template.html` asks nothing any more; the next launch reopens the mode on the same folder with the unsaved text in it. If the file changed on disk in between, the mode shows the disk's text and the draft opens in a new tab beside it, named in the problems panel. Closing the mode and choosing Discard now really drops its unsaved text.
- c005b91: TYTO-270: a workspace's `.tyto/project.json`, or the work profile it names, can declare export presets (ADR 0126): `"exportPresets": { "entregas": { "formats": ["grid-1x1", "story"], "folder": "entregas" } }`, with `types` defaulting to `png` and `folder` to the project's `output`. Presets merge by name, profile then folder; a preset's `folder` resolves against the open workspace folder whichever sheet wrote it, and a restricted folder confines it there (`W_PROJECT_PATH_OUTSIDE`, the preset is dropped). A preset with no folder and no `output` is `W_PROJECT_PRESET_NO_FOLDER`. `core` resolves them into `ResolvedProject.exportPresets`; `@tyto/io` reads nested ranges and follows a preset's folder through `realpath`. The window lists each preset in the command bar as "Export: <name>" (`export.preset:<name>`, bindable in `keybindings.json`) and runs it through the export box, which opens already running and removes what the previous export left as before.
- cbbf6df: TYTO-272: two new settings give each part of the window its own text size and face, over the two bases, applied on save with no restart. `fontSizes` and `fontFamilies` take a closed set of areas — `editor`, `json` (the settings, keybindings and snippets tabs) and `completion` over the code base, and `problems`, `commandBar`, `titleBar` (up to 18), `tabs`, `paneHeaders`, `statusBar`, `queue` and `explorer` (once there is one) over the UI base. An area left out follows its base, so changing the base still moves it. An unknown area or a size outside that area's bounds is a warning at that entry and the rest apply. A face the machine lacks is `W_FONT_FAMILY_MISSING` naming the area. The tab strips grow so a larger tab is never cut; the brief's editor and a settings tab beside it can be different sizes. A new `settings.json` lists every area under both keys, commented out. At the defaults the window is pixel for pixel what it was.
- c17b976: TYTO-272: five new settings, commented in a new `settings.json`, set the window's type and zoom, all applied on save with no restart. `uiFontSize` (9 to 24, default 14) scales every label outside the editor — tabs, panels, the status bar, the preview's controls and the dialogs — and the strips grow so nothing is cut; `codeFontSize` (9 to 32, default 14) sets the editor's, and the indent guides and pinned head lines follow. `uiFontFamily` and `codeFontFamily` name a face, with the bundled one drawn when the machine lacks it and `W_FONT_FAMILY_MISSING` in the problems panel. `zoom` (-5 to 5) zooms the whole window in steps of 20%: View's Zoom In, Zoom Out and Reset Zoom, on Ctrl and =, - and 0, now write it to `settings.json`. At the defaults the window is pixel for pixel what it was. The native menus and dialogs keep the system's font.
- 922caa8: TYTO-273: an editor group's header row shows where its caret is in the brief — `::lamina 2`, `::titulo`, or `cabeçalho › template` / `header › template` in the frontmatter — each group its own caret. Empty between blocks, after a block's last text line, for a settings tab and for a preview in front.
- fb2b470: TYTO-274: with a folder open, resting the pointer on a tab of a file inside it shows the path from the folder's name, as `promo\briefs\capa.brief`, instead of the whole path; a file outside the folder still shows `~\…`. Opening, closing or switching the folder updates the open tabs. An image's preview tab and the breadcrumb row now show the same path on hover. Nothing changes in how tab names look.
- 2d32db1: TYTO-275: a new brief from a template, built from its manifest. `@tyto/editor` exports `briefSkeleton`, which turns a manifest's required slots — and a repeated slot with a minimum of one — into a CodeMirror snippet whose fields Tab walks, `skeletonText` and `insertBriefSkeleton`; an enum value that is selected now completes to every value. The desktop's "New brief from template…" (Ctrl+K and the File menu) lists every template with its folder and description and opens the chosen one's skeleton in a new tab, and choosing a template in the picker on an empty brief writes the same skeleton. `templates:list` carries each template's slots and its folder.
- c9c17a3: TYTO-276: a "/" at the start of a line lists templates. `@tyto/editor` exports `slashCompletion(sources)`, `completeSlash`, `openSlashMenu` and the `slashRequested` effect: a "/" in column 0 of a brief, outside the frontmatter and with nothing after the cursor, opens a list of the rows each `SlashSource` hands it; typing filters, Enter replaces the "/" and the query, Escape leaves the "/", and `//` stays a comment. The desktop lists its templates there — the skeleton into a brief holding only the "/", or a switch of `template:` in one undoable edit on a brief with content, the row saying which — and registers `editor.insertMenu`, brief-only and with no default key, to open the same list from a binding in `keybindings.json`.
- 2495d0d: TYTO-277: a snippets file, as in VS Code. "Preferences: Open Snippets (JSON)" opens `snippets.json` beside `settings.json`, created with a comment on first open; an entry is `"Name": { "prefix": "aula", "body": ["::aula ${1:titulo}", "::prof ${2:nome}"] }`, so snippets copied from VS Code can be pasted. Typing a prefix at the start of a line in a brief offers the snippet, Enter inserts it with its first field selected and Tab walks the rest; the "/" menu lists the snippets under their own heading. While a completion list is open, Tab and Shift+Tab move through it. A save applies with no restart; a bad entry is a warning in the problems panel at its line, and a file that does not parse keeps the last snippets that did. The tab comes back with the session, and the file travels with the import from the previous version.
- e1611a3: TYTO-278: when an untrusted workspace folder leaves something out, a strip above the editor says so, with **Trust this folder** (applies what was left out at once) and **Show problems**. **Workspace: Manage Trust** shows the open folder and its state, with **Trust** and **Remove trust**; removing trust applies the next time the folder is opened (ADR 0111).
- fa24427: TYTO-278: File ▸ Open Folder opens a workspace folder, and File ▸ Close Folder closes it. A brief inside it previews and exports with the template, asset and font folders its `.tyto/project.json` names, the export dialog points at its output folder, and the folder comes back after a relaunch. The project file's problems, such as a key an untrusted folder may not use, are listed in the Problems panel with their place in the file (ADR 0113).
- ba00301: TYTO-279: main lists the open workspace folder one folder at a time, by ids it mints and never by path, and watches it so a file made outside the app is heard (ADR 0115). The explorer panel that shows it is the next pull request.
- 1687e7f: TYTO-279: an **Explorer** panel in the left area, above the queue, lists the open workspace folder. Opening a folder with File ▸ Open Folder opens it, clicking a brief opens it in a tab, and a file made or deleted outside Tyto shows within a moment. Its status-bar button and **Show or hide: Explorer** in the command bar show and hide it (ADR 0115).
- 017d381: TYTO-280: the window draws images and fonts an installed plugin supplies (ADR 0117, ADR 0119). The preview fetches what it lacks when the brief is saved or opened from disk, never while you type: a half-typed `test:lo` asks nobody, and the miss says to save. A face that arrives reaches the same preview, measured. The export box fetches too; the queue never does, and draws what a save already cached. A restricted folder fetches nothing and names Workspace: Manage Trust. A failed fetch is asked once per session, and the miss says a restart or a different reference asks again. `@tyto/io`'s `sourceCache` gains `remembersFailures` and a per-call `SourceCall`, and no longer remembers a miss it was not allowed to fetch.
- 90716e6: The window fetches a template's font this machine lacks from Google Fonts on first use, on save or open and never while typing, and names a font Google does not serve (likely licensed) with the free alternatives its template lists. The new `googleFonts` setting, on by default, turns it off (TYTO-281).
- cad535e: TYTO-282: the Explorer and the tabs show an icon for each file type: images, fonts, JSON, text files, template folders and the files in them, the project file, and the app's settings, keybindings and snippets. The output, assets and templates folders the project names get icons of their own. A brief gets a rubber stamp (ADR 0116).
- d755180: TYTO-286: the editor splits. Ctrl+\ opens the brief in front in a second group to the right, Ctrl+Shift+\ below (also on the View menu, in the command bar, and as `:vsplit` and `:split` in vim), and Ctrl+Alt+Left/Right moves between groups. Each group has its own row of tabs on top; the strip across the whole window is gone. The same brief can be open in two groups and typed into in either, with one undo history. The status bar, the problems panel, the preview and the title follow the group you are in. For now a window with several groups reopens after a restart as one group with every tab and draft. `@tyto/editor` makes several panes over one editor (`createPane`, `followerOf`, `isFollower`) and names the view in `onUpdate` and `onChange`.
- ab2041a: TYTO-286: the editor groups come back after a restart — the same splits, the same tabs in each group, the same group focused, and each group's cursor where you left it, even for one brief open in two groups. Three new commands on the View menu and in the command bar: focus the next or previous group (they wrap at the ends, as Ctrl+Alt+Left/Right now do), move the tab in front to the next group (with one group, it opens a split to the right for it), and close the group, which closes its tabs as Ctrl+W does and asks before dropping unsaved text. A session written by this version still opens in an older one, as one group with every tab.
- ffe3539: The previews come back after a restart — the following one and any locked on a brief — and the
  first launch opens the preview beside the brief, so a new person sees the art before they know
  Ctrl+Shift+V.
- 6320e1c: TYTO-287: the preview is a tab. Ctrl+Shift+V (or the button at the end of a brief's tab row, the View menu or the command bar) opens "Preview <name>" in the group to the right, and the preview follows whichever brief you bring to the front, as VS Code's Markdown preview does; "Lock" in its bar pins it to one brief, so two briefs' art can sit side by side. The PREVIEW panel and the right area's status-bar button are gone. A click in a preview focuses it, and export, Save and the problems panel act on the brief it shows. For now a new window opens with no preview until you ask for one, and the preview is not kept across a restart.
- 130a587: TYTO-288: a tab can be dragged along its strip to reorder it, or onto another group's strip to
  move it there; an accent line shows where it will land, and Escape or a drop anywhere else
  cancels. "Move tab left" and "Move tab right" (Ctrl+Shift+PageUp, Ctrl+Shift+PageDown) move the
  tab in front one place. The new order is kept across a restart.
- 5835e4c: TYTO-288: hovering a tab shows where its file is saved — its path, with the home directory
  written `~` (`~\briefs\campanha.brief`) — for a brief, for the preview of a brief, and for
  `settings.json`, `keybindings.json` and `snippets.json`. An untitled tab shows nothing. The path
  comes back with a tab restored from the last session. It is for display only: the window cannot
  open a file by it (ADR 0086).
- 8bab2fe: Every pane now has the same row of tabs on top — the editor groups, the previews, Problems, the
  queue and a plugin's panel alike — so their edges line up across the window, and an editor has a
  quiet row under its tabs, as VS Code's breadcrumbs are, where the location will go. The BRIEF bar
  and the template picker over the editor are gone: a template is chosen with "New brief from
  template…", the "/" menu or the `template:` line. "Open preview to the side" is at the right end
  of the tabs. A tab's name is quieter, and a panel's name reads like a file's, "Problems" rather
  than "PROBLEMS".

  The icons are drawn thinner, and how thin is a setting: `iconStrokeWidth` in `settings.json`,
  from 0.75 to 2, 1.25 unless it says otherwise. A save applies it at once.

- 1cc9e8e: The line between two editor groups can be dragged to give one side more room, and the window
  keeps the proportion after a restart. A double-click puts the groups back to equal sizes, the
  arrow keys move the focused line, and no group gets narrower than its minimum.
- 3b9ca57: TYTO-293: the editor draws a thin vertical guide at each indent level, as VS Code does, and the
  guide of the block holding the cursor in a stronger colour. A blank line inside a block keeps
  the guide; one between two blocks breaks it. The guides appear in brief tabs, the JSON tabs
  (settings, keybindings, snippets) and both buffers of the template mode. `"indentGuides": false`
  in `settings.json` hides them on save, with no restart. Two theme tokens are new,
  `indent-guide` and `indent-guide-active`, set by every built-in and pack theme (42 tokens).
- 0255852: TYTO-295: while the top of the editor is inside a block, the block's head line stays pinned
  there — `::lamina` while scrolling its body, and in the template mode each element the top is
  inside, stacked. The row slides away with the block's last line, a click on it goes to the
  directive, and the caret is never left under it. `"stickyScroll": false` in `settings.json`
  turns it off on save. A directive's fold now ends at its last line with text.
- 49e985f: TYTO-296 (ADR 0095): "Go to Block…" (Ctrl+Shift+O, in both input modes) lists the brief's blocks in the command bar — the frontmatter as "cabeçalho"/"header", every directive as `::lamina 2` with its first words beside it — and moving through the list previews each one; Enter leaves the caret on it and Escape puts the caret and scroll back. Brief-only and on the View menu, which now greys what the tab in front cannot use. `@tyto/editor` exports `briefBlocks`, `blocksOf` and `blockAt`: the blocks read from the syntax tree, numbered only for a slot the manifest says repeats, and remembered per tree.
- 74d7b28: TYTO-297: "Format Brief" ("Arrumar brief", Alt+Shift+F in both input modes and in the command bar) fixes a brief's indentation, trailing spaces and repeated blank lines in one undoable step; a brief with a syntax error is left alone and the status bar says why. Two settings, commented in a new `settings.json`: `formatBriefOnSave` (false by default) formats a brief before Save writes it, and `tabSize` (2 by default) sets what Tab inserts, the indent guides' step and the indent Format Brief writes, applied on save with no restart.
- d61d96f: TYTO-298: a new `briefColumns` setting, commented in a new `settings.json`, sets how the editor tells the columns of a brief's `|` lines apart: `off`, `separator` (the `|` coloured, the default), `alternate` (even columns muted too — in some themes the muted colour barely differs from the text) or `perColumn` (a colour per column — some themes draw a column below comfortable reading contrast). Applied on save, with no restart.
- 6670e15: Twenty colour themes in "Preferences: Color Theme": Dracula, One Dark, Nord, Solarized Dark and
  Light, Gruvbox Dark and Light, Tokyo Night and Tokyo Night Light each come as the original and as
  "(adjusted)", a version with the hard-to-read colours made readable, and the picker says
  "original colors" or "adjusted for contrast" beside each. Catppuccin Latte and Mocha read well as
  they are and come once.
- 3c13b00: Two well-known colour themes ship with the app: Dracula and Catppuccin Latte. Pick them with
  "Preferences: Color Theme" in Ctrl+K, like Tyto Light and Tyto Dark; the whole window and the
  editor change at once. They come from a built-in plugin of their own, `theme-pack` (ADR 0089).
- 5a0c7c5: `statusBarColors` in `settings.json` colours the status bar over the theme, in every theme:
  `background`, `foreground`, `itemHoverBackground`, `itemHoverForeground`, `itemActiveBackground`,
  `itemActiveForeground`, vim's badges (`vimMode.normal`, `vimMode.insert`, `vimMode.visual`,
  `vimMode.replace`) and one text colour per item (`item.problems`, `item.template`…). Colours are
  `#rgb` or `#rrggbb`; saving applies them with no restart, and removing one gives the theme's colour
  back. An unknown key or a bad colour is a warning at it and only that one falls back to the theme.
  A vim badge's text is the theme's best-reading colour on it, and a badge colour nothing reads
  4.5:1 on still applies, with a warning that says the ratio; so does a
  `background` or `foreground` that leaves the bar's own text under 4.5:1. A new `settings.json` carries the key
  commented out, with every key and an example colour.
- fe85505: The status bar shows what `statusBarItems` in `settings.json` lists, in that order inside each
  side: `leftArea`, `commandBar`, `vimMode`, `cursorPosition`, `tabKind`, `template`, `problems`,
  `queue`, `plugins`, `export`, `settings`, `bottomArea`, `rightArea`. Leave an id out to hide that
  item; saving the file applies it with no restart. Without the setting the bar is exactly as
  before. An unknown or repeated id is a warning at that entry and the rest still apply. A new
  `settings.json` carries the key commented out, with every id and what it is.
- e964def: Vim's mode in the status bar is a coloured badge: NORMAL, INSERT, VISUAL (line and block too)
  and REPLACE each in its own colour, in every theme, with text that reads at 4.5:1 or better. Until
  now the badge was always the accent colour, which in Tyto Light read at only 4.01:1. The rest of
  the bar looks as before. Themes gain ten colours for it: `status-bar` and `status-bar-text`, and a
  background and a text for each mode (`status-bar-vim-normal`, `status-bar-vim-normal-text`…).
- 29da92c: `vimModeStyle` in `settings.json` says how the status bar shows vim's mode: `"badge"` (the
  default, only the mode's name coloured), `"border"` (a strip along the bar's top edge in the
  mode's colour) or `"bar"` (the whole bar in the mode's colour, with text chosen to read on it at
  4.5:1 or better in every theme Tyto ships). `statusBarColors`' `vimMode.*` colours apply to all
  three, and under `"bar"` the mode's colour wins over `background`. Saving applies it with no
  restart; with vim off every style is the plain bar. A new `settings.json` carries the key
  commented out with the three values and what each does.
- c94ee21: TYTO-302: the local queue, Problems and a plugin's panel are drawn as tools, not as document
  tabs. Each has a tool header — its name in small capitals on the panel's own background, the
  same height as the editor groups' tab strips so the lines still meet — with the tool's actions
  at the right and the × that hides it last. The queue's "Choose folder…" moved out of the panel's
  body into its header as a folder icon; everything else in the queue stays where it was.
- f244b75: TYTO-304: the `keybindings.json` tab suggests as you type. Inside an entry, a quote lists the
  fields `key`, `command` and `when` not yet written; a `command`'s value lists every command id
  with the title the command bar shows, then `-<id>` for each one with a default key to remove;
  a `when`'s value lists the six contexts with what each means. Hovering a command's id shows its
  title and default key, a context what it means, and a field name what the field is. It works
  with vim on, in insert mode, and the file's warnings are unchanged.
- bf3fd0e: TYTO-304: the `settings.json` tab suggests as you type. A quote where a key goes lists every
  setting not yet in the file, with what it does; picking one writes it with its default selected.
  Inside a value it lists the values that setting accepts — `vimModeStyle`'s `badge`, `border` and
  `bar`, `true`/`false`, the installed themes — and inside `statusBarItems` and `statusBarColors`
  the item ids and colour keys not yet written. Hovering a key shows its description, type,
  default and accepted values. It works with vim on, in insert mode, and the file's warnings are
  unchanged.
- 68dd2ad: Help ▸ Documentation opens the user manual in your browser, in the app's language: the
  Portuguese edition when Tyto runs in pt-BR, the English one otherwise. It is also a command in
  Ctrl+K. The manual is published online with each desktop release (ADR 0101).
- 597da77: TYTO-323: the preview has two modes, **One slide** and **All slides**. All slides shows every slide of the chosen format in a grid, in order and numbered, scaled so they all fit; clicking one opens it as the main slide in One slide mode. Two buttons in the preview's bar switch the mode, as do the commands `preview.showOneSlide` and `preview.showAllSlides`, and each preview tab remembers its mode across a reload and a quit.
- 52cb44d: TYTO-323: a carousel's slides show as a strip of numbered thumbnails under the preview, and the Slide dropdown is gone. Clicking a thumbnail puts that slide on the stage and the editor on its `::lamina`; with the strip focused, the arrow keys, Home and End move along it. Thumbnails are the slide's own live document, scaled to 96 px tall; only the ones on screen are drawn, and a keystroke redraws only the slide it changed. A button in the preview's bar hides the strip, and each preview tab remembers that across a restart. When the slide shown is deleted from the end of the brief, the preview stays on the new last slide instead of going back to slide 1.
- e5e407e: TYTO-333: vim mode is remembered. A new `vimMode` setting (boolean, default `false`) is read at start, so the window opens with vim on when it is `true`. "Editor: turn vim mode on or off" (`editor.toggleVim`) writes it to `settings.json` in place, comments kept, so the choice survives a restart; a file that does not parse refuses the write and vim goes back to what the setting says. A hand edit of the setting turns vim on or off in an open window when the file is saved.
- 49db8d1: TYTO-347: the window shows the work profile an open folder names (ADR 0114). The trust strip has a line of its own for an untrusted profile that left something out, with **Trust this profile**, and a third button, **Show project**; Workspace: Manage Trust shows the profile with its own two buttons, none for a profile kept in `TYTO_HOME`. A profile's problems are listed in the problems panel with its file in front. Workspace: Show Project opens a read-only Project panel beside Problems listing `assets`, `templates`, `fonts` and `output`, each with its folders and `profile <name>`, `this folder` or `not set`. `workspace:trust` now takes a strict `source` (`folder` or `profile`) and still no path. `@tyto/io`'s `LoadedProfile` says whether it is trusted by where it lives (`byLocation`).
- 412a60f: TYTO-352: the explorer makes, renames and deletes files and folders. Right-click an entry for New File…, New Folder…, Rename… and Delete, or the empty space for the two New items; F2 renames and Delete deletes the selected entry. The name is typed in the tree, and a taken or impossible name keeps the field open with a line saying why. A delete always asks first and moves the entry to the Recycle Bin (the Trash on macOS and Linux). A renamed brief's tab shows the new name and keeps unsaved text unsaved; a deleted one's tab keeps its text in no file. A write the disk refuses for another reason, such as a read-only drive, now says so instead of failing silently.
- 2bb2cf3: TYTO-352: main can now create a file or folder, rename an entry and move an entry to the system's trash for the explorer, by id and name and never by path (`explorer:create`, `explorer:rename`, `explorer:delete`), and draw a native context menu of the window's items (`menu:context`). Names are checked the same on every operating system, nothing is ever overwritten, a delete never falls back to a hard delete, and open tabs follow a rename or let go of a deleted file. The window side comes in the next release.
- aebf304: The explorer's context menu opens from the keyboard (TYTO-364): Shift+F10 or the ContextMenu key on the selected entry opens the same menu a right click does, under that entry; with no entry selected, it offers New File and New Folder.
- b4ef3f4: TYTO-365: while a folder is open, the explorer's header has three buttons beside its close button. New File… and New Folder… open the same name field as the context menu, in the selected folder, the selected file's folder, or the top of the folder. Collapse All closes every open folder at every depth, and a selection inside one moves to the top-level folder that holds it.
- 274ad28: TYTO-366: clicking a `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` or `.svg` in the explorer shows it in the preview, with its name, its size in pixels and its size on disk in the preview's bar. Zoom, Fit and Lock work as for a brief, and the explorer keeps the focus. Bringing a brief to the front makes the preview follow it again. An image over 32 MB, a file whose contents are not the image its name says, and an image deleted while shown each get a line saying so. An SVG is shown as a picture: its scripts do not run and it loads nothing.
- 58f54d6: TYTO-370 (ADR 0134): an installed plugin can store and forget its own secrets. `host.credentials` is now a function with two methods: `host.credentials(key)` reads as before, `host.credentials.set(key, value)` stores, and `host.credentials.delete(key)` forgets and answers whether there was a value. Both need the same `credentials:<key>` permission, so an undeclared key is `E_PERMISSION`, in process and across the isolation boundary. A value is a non-empty string of at most 16 KiB in UTF-8 (`CREDENTIAL_VALUE_LIMIT_BYTES`); over it is the new `E_CREDENTIAL_TOO_LARGE` from `@tyto/core`. `HostCapabilities` gains optional `storeCredential` and `deleteCredential`; a host without them answers the new `E_CREDENTIAL_READ_ONLY`. The isolation protocol is 5. The desktop stores in the keychain, under the `plugin:<name>:<key>` account it already reads, lets a plugin's panel store and forget its own declared keys, and holds the plugins screen to the same 16 KiB. `tyto` stays read-only: a plugin's `set` or `delete` there is `E_CREDENTIAL_READ_ONLY`, naming the environment variable to set instead.
- d247c20: TYTO-371 (ADR 0138): the desktop gives installed plugins a private cache and the open folder's files. `host.cache` keeps entries in the same `TYTO_HOME` the plugins live in, and `host.workspace` reads and writes the folder open in the window, asked at every call, so a folder opened or trusted while the plugin runs is the one it sees; refusals name `Tyto desktop`. The plugins screen says in words what `workspace:read` and `workspace:write` reach. In `@tyto/io` the cache's sidecar now carries the bytes' SHA-256 and `get` answers a miss when it disagrees, so two processes racing on one key with bytes of the same size never hand back one's bytes as the other's; a sidecar written before the digest is a miss and the next `put` replaces it. One host now writes an entry in turn, and the atomic write tries a rename again while Windows says the target is busy, which an export's frames putting one key at once used to hit as `EPERM`.
- 5cab611: TYTO-377: the desktop runs a recipe in its main process, cell by cell, over `recipe:run` and `recipe:verbs`. It keeps each document's cells in memory and reruns from the first line that changed; a pause in typing stops before a source, which fetches on save or Run; a restricted folder runs only on Run, with its data files refused and its sections withheld; state is read and never written. The new `recipeTimeZone` setting names the IANA zone a recipe reads written times in (`null`, the default, is the machine's). No window draws the notebook yet.
- 82e915d: TYTO-415: a `lineNumbers` setting, as VS Code's `editor.lineNumbers`. `"on"` (the default)
  numbers each line, `"relative"` shows the cursor's line its own number and every other line its
  distance to it — what a vim count like `5j` moves — and `"off"` shows no numbers. It applies on
  save of `settings.json`, in every tab and the template mode, with or without vim.
- 53d664d: TYTO-418 (ADR 0143): vim mode gains its first plugin, commentary, and a `vimPlugins` setting
  that switches each vim plugin by id. `@tyto/editor` ships a `comment` operator (CodeMirror's
  `toggleComment`, so a Markdown or template line is wrapped in `<!-- -->` where vim's own
  `gc` does nothing; Markdown's comment tokens now reach it), passes an operation's `isEdit` to the engine so `.` repeats an action, and hands a
  mapping's `<character>` key to the operation as `selectedCharacter`. The desktop's built-in
  plugin contributes commentary on `gc` through `editor.vim`, the window reads every contribution
  on `plugins:vim` and maps the ones the setting leaves on, which is all of them unless one is
  named `false`; a save of `settings.json` switches them in place. The manual's Vim mode page gains
  a Plugins section, in English and Brazilian Portuguese.
- 3da246d: TYTO-418 (ADR 0143 amendment): vim mode gains surround, on by default and switched by the
  `surround` id of `vimPlugins`. `ys{motion}{pair}`, `yss{pair}`, `ds{pair}`, `cs{old}{new}` and
  visual `S{pair}` add, delete and change brackets or quotes around text; an opening bracket adds
  a space inside, and `.` repeats with the same pair. `@tyto/editor` ships it as two operations,
  an `s` motion after an operator that reads the operator before it and a `surround.add`
  operator, through a new `engine` operation kind, and reads the pair from the keyboard ahead of
  the engine. The desktop's built-in plugin contributes `s` in operator-pending mode and visual
  `S`. The manual's Vim mode page and the settings reference describe it, in English and
  Brazilian Portuguese.
- 60c2388: TYTO-419 and TYTO-442 (ADR 0143 amendment): vim mode in the desktop gains replaceWithRegister
  (`gr`, `grr`), exchange (`cx`, `cxx`, `cxc`, visual `X`), part of unimpaired (`[<Space>`,
  `]<Space>`, `[e`, `]e`), the indent and entire text objects (`ii`, `ai`, `ie`, `ae`), sneak
  (`s`, `S`, `;`, `,`), the yank flash, and a yank shared with the system clipboard. Each is
  switched by its own id in `vimPlugins`; all start on except sneak, which takes vim's own `s`
  and `S`. A plain `y` copies to the system clipboard (`"ay` does not), and text copied in
  another program is what `p` pastes once the editor has focus. The manual's Vim mode page and
  the settings reference describe them, in English and Brazilian Portuguese.
- ed73f34: TYTO-96 (ADR 0075): the window gets one visual language, Zed's One Light and One Dark, in one token file. `@tyto/editor`'s palette is now a list of `var(--tyto-…)` custom properties the host defines instead of two sets of literal colours, exported as `themeTokens`; a host that defines none gets an uncoloured editor. Its selection colour now wins over CodeMirror's base rule while the editor is focused, and `restore` brings a stored tab up to the theme the editor is in now. The desktop defines every token in `src/renderer/tokens.css`, draws in the bundled Source Sans 3, follows the system's light or dark live in the window and in every editor, and fails `pnpm check` on a literal colour, radius, size or font anywhere else in the renderer.

### Patch Changes

- 7cf6a11: TYTO-120: opening a file no longer replaces an untitled tab that was typed into and then emptied. The tab stays beside the new file, and Ctrl+Z in it brings the deleted text back. The same holds for a tab that lost its file to a save-as and was then emptied. The untouched tab the window opens on is still replaced, as before.
- 4e440f4: TYTO-144: the crash box now has a button that opens the log folder, so sending the log after a crash is one click instead of copying a path into a file manager.
- 6847c83: TYTO-146: the macOS `dmg` is universal, so it opens on an Intel Mac as well as on Apple Silicon. The bundled Node that runs plugins carries both architectures too.
- 7a56ce2: TYTO-155 — nothing in the app changes; this corrects the 0.3.2 entry and records how dependency
  bumps reach this changelog from now on.

  **The 0.3.2 entry gives the wrong reason for the red Dependabot pull requests.** It says every
  one of them arrives red on `changeset status` because Dependabot cannot write a changeset. The
  measurement that followed showed otherwise: `changeset status` fails only when `.changeset/`
  holds no file at all, so a Dependabot pull request was red whenever no other changeset was
  pending — right after each version PR — and green otherwise, with no commit of its own. The
  0.3.2 entry is left as published; this is its correction.

  From now on the pull request check asks whether each changed package is named in a changeset of
  that pull request's own, and a Dependabot bump of a dependency that ships with the app (Electron
  among them) gets its line here written by the release workflow, naming the old and new version
  (ADR 0070).

- 49c1569: TYTO-239: the queue panel no longer reads its inbox while it moves a finished task to `done/`. On Windows that read held the task's brief open and the move failed with `EPERM`; a short retry hid it, and now the queue does not race itself at all. The retry stays for locks held from outside Tyto.
- 93fcb8b: Exporting over an artwork file another program holds open ends the export with its failure message instead of an `E_OUTPUT_WRITE` diagnostic, and a folder where an artwork goes shows `E_OUTPUT_FILE_BLOCKED` (TYTO-245, ADR 0108).
- 4c45704: A page's own `window.close()` now goes through the same quit handshake as the window's X button, so the session's final write runs first: a draft typed just before it comes back on the next launch, and the settings tab's pending screen changes reach the file. A reload, whether the window or DevTools starts it, still reloads.
- 32f17c6: TYTO-255: a settings edit is no longer lost while `settings.json` is open in a tab. A change made from a screen right after typing in the tab, or a save of the file from another editor while the tab has unsaved typing, now lands in the tab under the typing, so the next save keeps both. Closing the tab without saving discards only the typing: a change made from a screen while it was open is written to the file.
- 0dd0e56: TYTO-256: the settings and keybindings tabs colour their JSON: keys, values, numbers, `true`/`false`/`null` and comments each in their own colour, in the light and the dark theme.
- 9727c28: TYTO-257: a new version's first run now offers the previous version's `keybindings.json` with the settings, layout and recent files, copied byte for byte, so a person's own keys keep working after an update. A file that does not parse stays behind in the older folder, as an unparsable `settings.json` does.
- 9bd7527: TYTO-258: the editor's find panel, its completion list and the tooltip on a problem now match the window in light and in dark — the same raised surface, hairline and type — instead of CodeMirror's grey defaults. The selected completion is the selection's colour, quiet, and a problem's underline is the problem's own colour.
- f82f71b: TYTO-259: the line under the preview that said "Problems: N" or "No problems" is gone. It counted only the brief's problems while the status bar's problems button counts every row of the Problems panel, so the window could show two different numbers at once; the status bar's count is now the only one.
- a6f85ed: A save failure leaves the problems panel, and the status bar's count, as soon as the next save of that tab goes through; a file reported missing leaves it when the same recent entry opens again. A removal never lights the new-problems dot, and puts it out when no row is left for it to point at.
- eaf3dc6: TYTO-263: on Windows, with a menu's list open from the title bar, Left and Right close it and open the neighbouring menu's list, wrapping at the ends — with Help open, Left opens Window, and with File open, Left opens Help. The arrow that moved the menu no longer reaches the editor or the menu row. Linux and macOS are unchanged.
- 9d599db: TYTO-267: the problems panel's heading no longer shows its own problem count. With the panel open the same number used to appear twice — in the heading and on the status bar's problems button; now only the status bar shows it. The button's screen-reader label now includes the count, since the heading's count was the one a screen reader could read.
- efec94c: TYTO-268: when a brief is written but nothing can be drawn from it — a template that does not exist, a frontmatter that will not parse — the preview now says "This brief has an error — see Problems" instead of "Write a brief to see it here", which it keeps for an empty buffer. When an artwork had already been drawn, the preview still keeps it on screen, marked as older than the text.
- aac15e5: TYTO-269: the brief editor draws with the bundled IBM Plex Mono instead of whichever monospace the machine has, so it shows the same face and the same columns on every computer, in light and in dark. Comments stay italic, slanted by the browser, since no italic face is shipped.
- 1ee2f97: TYTO-283: with `settings.json` or `keybindings.json` in front, the commands that act on a brief — Export, the preview's zoom, format and slide steps — are no longer offered in the command bar, do nothing on a key bound to them, and are greyed in the File menu and the status bar. Before, Export opened its dialog there and wrote the JSON out as `editaveis/settings.json.brief` beside a `result.json` of syntax errors.
- d84eaa1: TYTO-285: nothing changes when you press Ctrl+Enter — it still adds a line, as it always did. What is gone is the built-in binding behind it to a render command the window never had, and a test now fails if any built-in key names a command the window does not register.
- ef0584b: TYTO-288: the line under every tab strip is gone — under each editor group's tabs, a preview's, and the name of a docked panel such as the queue or Problems. The strips keep their height, so they still meet across the window.
- f3739a3: TYTO-299: editor groups no longer overlap when the window is too narrow. Each split is held at its groups' minimum size, and the side and bottom docks give way first, down to 160 px across or 96 px tall (or their own smaller size); the sizes saved in the layout are unchanged, so a wider window gives them back. When even that is not enough, the last groups are clipped at the editor's edge instead of being painted over each other or pushing a dock out of the window.
- 5db30d3: TYTO-322: the empty Problems panel names the document in front. With `settings.json`, `keybindings.json` or `snippets.json` active it says "Nothing to report about settings.json" (and the same for the other two) instead of "about this brief", in English and in Brazilian Portuguese; with a brief in front it still says "this brief". The manual's settings picture is retaken with the new sentence.
- 8b61655: A template made with **New template…** is listed by **New brief from template…** and clears `E_TEMPLATE_FOLDER_EMPTY` as soon as it is created, without a Save first (TYTO-324).
- d08be0d: TYTO-325: the Export dialog opens with PNG ticked instead of SVG the first time a window exports. A choice made in the dialog is still kept while the window stays open, and a restart starts from PNG again. A build that does not offer PNG ticks the first file type it does offer, so the dialog never opens with Export greyed out for no visible reason.
- 20822f2: TYTO-331: in vim mode, Escape pressed right after typing goes back to normal mode on the first press. It used to stay in insert mode — 10 of 10 times in a visible window — because the key closed a completion that had not appeared yet. Escape on an open completion popup still only closes the popup. `keybindings.desktop.test.ts` now launches with `--disable-frame-rate-limit` (ADR 0104), which is what exposed this.
- d3df40e: The Export dialog's **Formats** ticks are honoured when the brief lists formats (TYTO-332, ADR 0107). The list offers only the sizes on the brief's `formats:` line, and unticking one leaves it out of the export, where before every listed size was written whatever was ticked.
- 4475943: TYTO-334: the window in Brazilian Portuguese no longer shows Electron's English in its menus. Every role item — Undo, Cut, Copy, Paste, Select All in Edit, Exit in File, the developer tools and full screen in View, Minimize and Zoom in Window, and macOS's application menu — carries the catalogue's word for it (Desfazer, Recortar, Copiar, Colar, Selecionar tudo, Sair, Ferramentas do desenvolvedor, Tela cheia, Minimizar, Maximizar), and the Edit list is written out so Electron no longer fills it in English. A new `keybindings.json` or `snippets.json` starts with its notes in the window's language, and the keybindings tab's suggestions and hover say what each field is in it too. Problem messages are still English (TYTO-342).
- 4aba89c: TYTO-347: a workspace's `.tyto/project.json` can name a work profile, a sheet many folders share (ADR 0114). `"profile": "saude"` reads `TYTO_HOME/profiles/saude/profile.json`, trusted by where it lives; a path names a profile file elsewhere, which is its own source in `trust.json` and is confined to its own folder until it is trusted. The profile's keys come first and the folder's win key by key. `core` reads the key with `profileReferenceOf`, refuses a restricted folder a profile path outside it, ignores a profile's own `profile` key (`W_PROFILE_NESTED`), and says in `ResolvedProject.origins` which sheet each value came from; `W_PROJECT_PROFILE_UNSUPPORTED` is replaced by `W_PROJECT_PROFILE_INVALID` and `W_PROJECT_PROFILE_MISSING`. `@tyto/io`'s `loadWorkspace` reads the profile with its own trust answer and follows its paths through `realpath`. `tyto render` uses it, prints a profile's problems against the profile's file, `--trust` covers the folder and its profile for the run, and `tyto trust remove` takes a profile file's approval back. The window resolves a folder's profile through the same loader; showing it is the next change.
- e4255e4: TYTO-350: one JSONC reader for the project file and the settings file. `@tyto/io` exports `readJsoncText`, the reader `readProjectText` already used (parse, recovery around a syntax error, the range of every key and of every syntax error), now taking the file's own syntax code and its "not an object" problem. The desktop's `settings.json` is read through it and keeps its own in-place writer. Nothing a person sees changes: the same codes, messages and ranges as before.
- 41afd9c: TYTO-351: the brief's red underline follows a re-preview that no keystroke started. Choosing or clearing the templates folder, trusting a workspace folder or a save that fetched an asset used to update the art and the problems panel while the underline stayed until the next key; every preview answer now asks the panes on that brief to lint again.
- Updated dependencies [7cf6a11]
- Updated dependencies [d4a6939]
- Updated dependencies [c141ec9]
- Updated dependencies [08b936d]
- Updated dependencies [7342c02]
- Updated dependencies [15997e9]
- Updated dependencies [15997e9]
- Updated dependencies [49c1569]
- Updated dependencies [93fcb8b]
- Updated dependencies [b713378]
- Updated dependencies [752ddd2]
- Updated dependencies [ea97dc3]
- Updated dependencies [3921252]
- Updated dependencies [0dd0e56]
- Updated dependencies [0dd0e56]
- Updated dependencies [9bd7527]
- Updated dependencies [99f185d]
- Updated dependencies [aac15e5]
- Updated dependencies [c005b91]
- Updated dependencies [cbbf6df]
- Updated dependencies [cbbf6df]
- Updated dependencies [cbbf6df]
- Updated dependencies [c17b976]
- Updated dependencies [922caa8]
- Updated dependencies [2d32db1]
- Updated dependencies [c9c17a3]
- Updated dependencies [2495d0d]
- Updated dependencies [2495d0d]
- Updated dependencies [6abf89f]
- Updated dependencies [91efbbb]
- Updated dependencies [017d381]
- Updated dependencies [53e01c3]
- Updated dependencies [ae75027]
- Updated dependencies [d84eaa1]
- Updated dependencies [d755180]
- Updated dependencies [3b9ca57]
- Updated dependencies [3b261d1]
- Updated dependencies [0255852]
- Updated dependencies [49e985f]
- Updated dependencies [74d7b28]
- Updated dependencies [74d7b28]
- Updated dependencies [d61d96f]
- Updated dependencies [6670e15]
- Updated dependencies [3c13b00]
- Updated dependencies [d218cbe]
- Updated dependencies [fe85505]
- Updated dependencies [5a0c7c5]
- Updated dependencies [e964def]
- Updated dependencies [bf3fd0e]
- Updated dependencies [f244b75]
- Updated dependencies [bf3fd0e]
- Updated dependencies [e39f1d7]
- Updated dependencies [8e9c9c4]
- Updated dependencies [ab9512e]
- Updated dependencies [ab9512e]
- Updated dependencies [20822f2]
- Updated dependencies [d3df40e]
- Updated dependencies [e7ea146]
- Updated dependencies [49db8d1]
- Updated dependencies [4aba89c]
- Updated dependencies [3fa8604]
- Updated dependencies [e4255e4]
- Updated dependencies [41afd9c]
- Updated dependencies [58f54d6]
- Updated dependencies [d247c20]
- Updated dependencies [6511c41]
- Updated dependencies [7a5f578]
- Updated dependencies [3355317]
- Updated dependencies [eb55249]
- Updated dependencies [a2b7fbd]
- Updated dependencies [532221f]
- Updated dependencies [15e11fb]
- Updated dependencies [719585d]
- Updated dependencies [5f98674]
- Updated dependencies [cfa70ff]
- Updated dependencies [bdab5da]
- Updated dependencies [eb0694a]
- Updated dependencies [7704e9c]
- Updated dependencies [dded20c]
- Updated dependencies [320c0c7]
- Updated dependencies [dd7563b]
- Updated dependencies [c7cf84e]
- Updated dependencies [e4ce1e8]
- Updated dependencies [fdcfda9]
- Updated dependencies [82e915d]
- Updated dependencies [82e915d]
- Updated dependencies [4186112]
- Updated dependencies [3da246d]
- Updated dependencies [53d664d]
- Updated dependencies [3da246d]
- Updated dependencies [40f2f0b]
- Updated dependencies [f8052b8]
- Updated dependencies [f75a2f6]
- Updated dependencies [885d0f5]
- Updated dependencies [3921252]
- Updated dependencies [0f5ad72]
- Updated dependencies [ffd4770]
- Updated dependencies [cf54765]
- Updated dependencies [431bf23]
- Updated dependencies [ed73f34]
  - @tyto/editor@0.8.0
  - @tyto/plugin-api@0.5.0
  - @tyto/core@0.29.0
  - @tyto/io@4.0.0
  - @tyto/pipeline@0.11.0
  - @tyto/fonts@0.4.0
  - @tyto/google-fonts@0.1.0
  - @tyto/theme-pack@0.1.0
  - @tyto/brief-lang@0.7.0
  - @tyto/recipe@0.1.0
  - @tyto/templates@1.0.2
  - @tyto/export-html@0.7.1
  - @tyto/export-svg@2.0.1
  - @tyto/template-lang@0.8.1

## 0.7.0

### Minor Changes

- d713706: The plugins screen sets and clears a plugin's declared credentials, kept in the system keychain. The window can no longer read a stored secret back, and it can set or forget only a key an installed plugin declares.
- 1509dce: The installed app updates itself from the newest `desktop-v*` release: it downloads in the background and installs when the app quits, after the unsaved-tabs question (Windows installer and Linux AppImage). The Windows portable and macOS show a link to the release page. A footer notice names the new version. No network or a broken feed: the app opens normally and logs one line (TYTO-131, ADR 0069).

### Patch Changes

- f6b21d3: The packaged app now checks its own `app.asar` and loads only from it (TYTO-241, ADR 0067).
  Electron's `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` fuses are on, so on
  Windows and macOS an archive changed after packaging refuses to start, and an `app/` folder put
  beside the archive is never loaded. Linux packages carry no hash, so there the archive is not
  checked.
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

- 909d9e9: The packaged app no longer opens a debugger on its main process when started with `--inspect`
  (TYTO-249, ADR 0067). Electron's `EnableNodeCliInspectArguments` fuse is off, so a program on the
  same machine can no longer run code in main that way. The packaged test suite now drives the app
  over the Chrome DevTools Protocol and quits it through the quit guard.
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

- 1debd1a: The packaged app can no longer be run as a plain Node: Electron's RunAsNode and `NODE_OPTIONS`
  fuses are switched off (TYTO-193, ADR 0067). Installed plugins now start their process with
  `spawn` instead of `fork`, which Electron refuses once that fuse is off; they still run on the
  bundled Node, under the same permissions.
- Updated dependencies [e9984eb]
- Updated dependencies [b20fe47]
- Updated dependencies [7dad141]
- Updated dependencies [4532332]
  - @tyto/editor@0.7.1
  - @tyto/io@3.0.0
  - @tyto/core@0.28.0
  - @tyto/template-lang@0.8.0
  - @tyto/export-html@0.7.0
  - @tyto/export-svg@2.0.0
  - @tyto/brief-lang@0.6.8
  - @tyto/fonts@0.3.0
  - @tyto/pipeline@0.10.1
  - @tyto/plugin-api@0.4.1
  - @tyto/templates@1.0.1

## 0.6.0

### Minor Changes

- 8ca8eed: TYTO-205: a delivery carries its brief in `editaveis/` and the images the brief used in `assets/` (ADR 0057). The desktop export box now delivers into the picked folder — artwork at the top, `editaveis/`, `assets/` — and `tyto render --folder` gains `assets/` under its `<out>/<brief-name>/` level. The copied brief's image paths name the copies, and a brief in a folder named `editaveis` also reads `../assets`, so it renders again from where it sits. `E_ASSET_NOT_FOUND` names the folders actually searched.
- a84b756: TYTO-127: exporting again into a folder used before removes what the previous export wrote there and this one did not produce, and says so (ADR 0054). It applies to `tyto render --folder` and to the desktop's export box. `--out`, `tyto watch` and the queue panel are unchanged.

  A carousel edited from four slides down to three no longer delivers the fourth, and a delivery made before ADR 0053 loses its `lamina-*` files on the first export after the upgrade. Only a file the previous `result.json` listed can go, and only while its size is still the recorded one. A file somebody added or replaced by hand stays. Each removal is a `W_LEFTOVER_REMOVED` warning on stderr, in `result.json` and in the export box. A kept file is a `W_LEFTOVER_KEPT` with the reason, and a previous report that cannot be read is a `W_PREVIOUS_RESULT_UNREADABLE`.

  `@tyto/io`: `fsTaskOutput` takes `removeLeftovers` and, like `fsDeliveryOutput`, returns a `ReusableTaskOutput` whose `removeLeftovers(run)` is called before `finish`.

- 2b4f568: TYTO-223: the window's preview, export and queue hand each template the brand kit its
  manifest's `brand` names, from the installed plugins (ADR 0063). When two plugins offer one
  brand, the one registered first is used and `W_BRAND_KIT_SHADOWED` appears with the preview's
  and the export's diagnostics.
- 78b46b0: Run each installed plugin on a Node the app carries, confined to its own folder (TYTO-186,
  ADR 0050). The app ships Node 24.21.0, the Node its Electron embeds, at `resources/node/`.
  The version and each platform's sha256 are pinned in `bundled-node.json`, and `pnpm build`
  fetches it from nodejs.org. A plugin's process is a child of that Node under `--permission`,
  with read access to its folder and its bootstrap only, and an empty environment. It proves it
  is confined before its code is imported, and the host now refuses it otherwise
  (`E_PLUGIN_SANDBOX`). The network is still not confined, and the plugins screen says so. The
  installers grow by 22.4 MiB on Windows, 37.4 MiB on macOS and 43.0 MiB on Linux.
- 7bab967: TYTO-189: the desktop app previews and exports an installed plugin's code templates, drawn in the
  plugin's utility process, and they join the Template picker with its other templates. The queue
  still renders PNG only. The plugins screen says which faces installed on this computer a
  `font:<family>` permission sends, and so does `tyto plugin install` before it asks.
- 3363bb6: TYTO-45: the desktop has a local queue panel (File > Show the local queue). It works over a
  folder laid out as `tyto watch <folder>` lays it out and lists each task folder in `inbox/` and
  `done/` as pending, rendering, done or error. A failed task shows its diagnostics. Each task can
  be run or retried, its brief opened in the editor to fix it, and its `out/` folder opened. With
  auto-run on (off by default), a folder dropped into `inbox/` renders on its own. A failed task
  is never re-run without being asked. Use one consumer per folder: a task another program moved
  first is reported on the task, not as a crash.
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
- a33a192: TYTO-188: each local queue folder chooses which file types its tasks produce, in the queue
  panel's "Produces" row, installed exporters' kinds included. A folder nobody chose for still
  produces PNG alone. A chosen kind whose plugin was removed is left out with a new
  `W_QUEUE_KIND_UNAVAILABLE` warning instead of failing the task (ADR 0061).
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

- 94fdee3: TYTO-50: the desktop lists an installed plugin's templates in the Template picker and previews
  and exports with them, searched after a chosen folder and the built-in pack and checked by the
  CLI's own rule (ADR 0046), now `installedPacks` in `@tyto/io`. A plugin refused over its pack is
  a row in the problems panel and is kept out of the preview, the panels and the export. Installing
  a folder that holds a link no longer fails with an internal error on Windows: a link inside the
  folder is copied as its target, and one that leads out or nowhere is `E_PLUGIN_LINK`, exit 1.
  `PluginStore.add` answers a `Result`.
- b1b0745: TYTO-49: plugin panels (ADR 0045). A `panel` contribution names a page inside the plugin's
  folder (`entry`) and crosses from an isolated plugin as data. The desktop serves it as
  `tyto-plugin://<plugin>/<entry>`, confined to that folder and with no network, into an iframe
  with `sandbox="allow-scripts"` alone: it cannot read the window, the app's storage or the
  preload, and its frame stays on its own plugin's pages. It asks the host for `fetch` and
  `credentials` through a `postMessage` bridge checked against the plugin's permissions. It hears
  the open brief's text, which the plugins screen now states. It opens closed from the command bar,
  and the bottom dock lays its panels side by side. The template mode's sample brief resolves
  plugin directives.
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

- 9f3f070: TYTO-49: plugin directives work in the window. An installed plugin's `::namespace/name` is
  resolved by the preview and by the export, in the plugin's own process, and without the plugin
  it is `E_UNKNOWN_DIRECTIVE`, underlined on its name. The brief editor gains the underline and the
  completion list it never had: after `::` it offers the template's slots and the plugins'
  directives, and adjustments and enum values where they apply. Both are fed by the preview's
  answer, so the underline, the problems panel and the list come from one pass in main.

### Patch Changes

- 0937670: TYTO-204: an asset path in a brief is read as written, from the brief's folder first, and from `assets/` beside the brief when nothing is there (ADR 0056). The same rule holds in `tyto render`, `tyto watch`, the desktop queue, preview, export box and the template editor's preview, so a folder with its images in `assets/` renders the same in the CLI and in the app. `./assets/logo.png` now resolves everywhere, and when a file of the same name exists both beside the brief and in `assets/`, the one beside the brief wins. `tyto render --assets <dir>` still names the one folder searched, with no fallback. `E_ASSET_NOT_FOUND` now says it looked in `assets/` too.

  `@tyto/io` migration: `BriefTask.assetBase` is now `briefDirectory` (the brief's folder); resolve assets with `briefAssetResolver`.

- b957b79: TYTO-214: the window's preview and export hand a bundled code template the files in its own folder,
  through `context.files` (ADR 0062), as `tyto render` does. Before, a code template could not draw a
  background kept beside its manifest in the app.
- e31ce3d: TYTO-196: the export dialog and the template picker name each format by its `formats.yaml` label
  ("Grid 1:1") instead of its id (`grid-1x1`), and still send the id. A format with no label shows
  its id, as before.
- 25df5b2: TYTO-216: the window binds the brief's files and the template's through `layeredExportResources`,
  the function `tyto render` already uses, in place of its own two copies. No output changes: the
  window's SVG for a `cover` image is byte-identical before and after, and to the CLI's.
- 055730d: The preview panel no longer shows a story cut at 1080 px. A fresh preview frame kept the first of two documents when the second arrived before the first had loaded, so a story clicked right after a brief opened showed the square format's document, with checkerboard below it. The panel now loads one document at a time and applies the newest one when the previous load ends (TYTO-219).
- 93eabdf: The template mode's preview grid no longer keeps an old sample. A fresh cell whose sample changed before its first load kept the first one, the same race the preview panel had in TYTO-219. Both now go through one rule that loads one document at a time and applies the newest when the previous load ends (TYTO-220).
- 7efc445: TYTO-176: a markup template that draws from its own folder (`<vector src="assets/…">`,
  `<image src="assets/…">`) renders in the window's preview and export, as it does in
  `tyto render`. Before, the window reported `E_TEMPLATE_MARKUP` or `E_TEMPLATE_VALUE` and drew
  nothing.
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

- b429f87: TYTO-199: a queue task run again after its brief lost slides no longer keeps the old slides in
  `outbox/<id>/out/` (ADR 0059). The queue applies the export box's rule from ADR 0054: only a file
  the previous `result.json` listed can go, each removal is a `W_LEFTOVER_REMOVED` warning in the new
  `result.json` and in the panel, and a retry that fails again keeps the older files. `tyto watch` is
  unchanged.
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
  - @tyto/editor@0.7.0
  - @tyto/brief-lang@0.6.7
  - @tyto/export-html@0.6.4
  - @tyto/export-svg@1.3.4

## 0.5.2

### Patch Changes

- fc8814f: Bump Electron to 44.4.5.
- Updated dependencies [1116f2d]
  - @tyto/editor@0.6.7

## 0.5.1

### Patch Changes

- Updated dependencies [b749c43]
- Updated dependencies [17ad960]
  - @tyto/templates@0.6.0
  - @tyto/core@0.26.0
  - @tyto/brief-lang@0.6.6
  - @tyto/editor@0.6.6
  - @tyto/export-html@0.6.3
  - @tyto/export-svg@1.3.3
  - @tyto/fonts@0.2.0
  - @tyto/io@1.3.7
  - @tyto/pipeline@0.9.1
  - @tyto/plugin-api@0.3.9

## 0.5.0

### Minor Changes

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

- 56e1b6f: TYTO-183: Tab indents the line (or every selected line) by two spaces in the brief editor, and
  Shift+Tab takes them back. To move focus out of the editor with the keyboard, press Escape and then
  Tab.
- Updated dependencies [8092940]
- Updated dependencies [b587f0d]
- Updated dependencies [56e1b6f]
  - @tyto/templates@0.5.0
  - @tyto/core@0.25.0
  - @tyto/fonts@0.2.0
  - @tyto/pipeline@0.9.0
  - @tyto/editor@0.6.5
  - @tyto/brief-lang@0.6.5
  - @tyto/export-html@0.6.2
  - @tyto/export-svg@1.3.2
  - @tyto/io@1.3.6
  - @tyto/plugin-api@0.3.8

## 0.4.0

### Minor Changes

- 8b24969: TYTO-151 — a new version of the desktop app offers, once, to bring the templates folder, the
  panel layout and the recent files across from the highest older version on the machine (ADR
  0036). The older version's folder is copied, never moved; declining is recorded in the new
  folder and not asked again. Saved sign-ins travel only when the person ticks a separate,
  unticked box. Anything the older folder could not give is a new `W_IMPORT_SKIPPED` warning in
  the log, and never stops the app from opening.

### Patch Changes

- Updated dependencies [8b24969]
  - @tyto/core@0.24.0
  - @tyto/brief-lang@0.6.4
  - @tyto/editor@0.6.4
  - @tyto/export-html@0.6.1
  - @tyto/export-svg@1.3.1
  - @tyto/io@1.3.5
  - @tyto/pipeline@0.8.2
  - @tyto/plugin-api@0.3.7
  - @tyto/templates@0.4.1

## 0.3.4

### Patch Changes

- Updated dependencies [80a03a8]
- Updated dependencies [d3587dd]
  - @tyto/core@0.23.0
  - @tyto/export-html@0.6.0
  - @tyto/export-svg@1.3.0
  - @tyto/templates@0.4.0
  - @tyto/brief-lang@0.6.3
  - @tyto/editor@0.6.3
  - @tyto/io@1.3.4
  - @tyto/pipeline@0.8.1
  - @tyto/plugin-api@0.3.6

## 0.3.3

### Patch Changes

- Updated dependencies [353c83d]
  - @tyto/pipeline@0.8.0
  - @tyto/templates@0.3.0
  - @tyto/core@0.22.2
  - @tyto/io@1.3.3
  - @tyto/brief-lang@0.6.2
  - @tyto/editor@0.6.2
  - @tyto/export-html@0.5.5
  - @tyto/export-svg@1.2.3
  - @tyto/plugin-api@0.3.5

## 0.3.2

### Patch Changes

- 91b6bc5: Dependency bumps in the prod group: `yaml` 2.9.0 → 2.9.1, `zod` 4.6.1 → 4.6.5, and
  `@codemirror/commands`, `@codemirror/state` and `@codemirror/view` to their latest patches.

  These are dependencies of what ships, so they get a patch and a line in the changelog rather
  than passing through unnamed. Written by hand because Dependabot cannot write a changeset — it
  has no idea this repository uses them — which is what makes every one of its PRs arrive red on
  `changeset status`. TYTO-155 is the card for fixing that properly.

- 7d02738: TYTO-137 — the export dialog can now choose which formats to render, at 1× or 2×, and how hard
  to compress the lossy types. Until now it rendered every format the template declares, at scale
  1, with quality 90 that nobody picked.

  **Three controls, and the defaults are exactly today's behaviour.** Open the dialog, click
  Export, and the request that goes out is byte-identical to the one before this card: every
  format ticked, no scale, quality 90.

  - **Formats** — a checklist of the formats this brief's template declares, all ticked. Untick
    `story` and only the feed frames land. Unticking all of them disables Export, the same way
    unticking every file type already did: an export of no formats is an export of nothing, and
    it must not be read as "all of them".
  - **Scale** — 1× or 2×, and it only appears when a type made of pixels is ticked. 2× is the same
    design at twice the resolution, not a design given twice the room.
  - **Quality** — 1-100 for JPEG and WebP. It only appears when one of those two is ticked, so
    asking for quality on PNG is impossible from the form rather than refused afterwards: the
    raster port throws a `TypeError` for it, because PNG is lossless and a caller who thought it
    had asked for a smaller file deserves to be told it had not.

  **Nothing in main changed, and no channel was added.** `export:start` has accepted `formats` and
  a per-output `scale` since TYTO-43; this fills in two fields the window was leaving empty. The
  format list is a lookup rather than a round trip — `templates:list` already answers with each
  template's format ids and the window is holding that answer, so the dialog is handed the list
  for the template the brief names. A brief that names no template, or one whose manifest this
  window does not have, keeps the note that says every format will be rendered, which is what the
  request will do.

  **Measured through the window, in the files that landed.** `promo-curso` declares `feed` and
  `story`: unticking `story` and exporting PNG produced one frame at 1080×1080 (the count says a
  format was dropped, the size says which one), and the same export at 2× produced 2160×2160. Both
  are new end-to-end cases; the suite is otherwise SVG on purpose, and this is the exception the
  criterion requires, since an SVG has no pixels to double.

  Two things it deliberately does not do: it does not remember the choices between exports, and it
  does not re-read the checklist while the dialog is open — the brief behind a modal cannot be
  typed in, and a checklist rebuilding itself under somebody's hand would be worse than one that
  does not.

- 9cd091f: TYTO-153 — closing the app with unsaved tabs now offers **Sim**, **Não** and **Cancelar**, the way
  every editor does, instead of offering only two answers of which neither saved.

  The box used to ask _Sair sem salvar?_ and give you two ways out: lose the work, or stay in the
  program. The answer almost everybody wants after hitting the X by mistake — save it, then go — was
  not on screen at all. Its absence does not read as a deliberate choice; it reads as an app that
  cannot save.

  It asks _Deseja salvar o trabalho?_ now. **Sim** writes every dirty tab and then quits, opening a
  Save-As dialog for each tab that has never been saved, so three untitled tabs mean three file
  pickers and one question rather than three questions. **Não** quits without saving, which is what
  the old confirm button did. **Cancelar** puts you back in the editor with everything exactly as it
  was, and the app still quits normally on the next attempt.

  **Anything short of every tab being written cancels the quit.** A save that fails — a full disk, a
  folder gone read-only — leaves the app up and says what went wrong in the problems panel, where
  save failures have gone since TYTO-124. So does a Save-As you dismiss, which is how somebody
  changes their mind halfway through an answer. Quitting anyway would be the app discarding the work
  of somebody who had just asked for it to be kept, which is the bug TYTO-147 closed wearing the
  label of a feature.

  **Enter saves and Escape stays.** That reverses the old box, where the default was Cancel, and it
  is safe here for a reason the old one did not have: neither of those two keys can now cost you a
  word. The tab-closing box is unchanged and still points both keys at the safe button, because both
  of its answers can lose a document.

  The third button needed a shape the app did not have: `dialog:confirm` is a two-button channel
  whose answer is a boolean. It travels on a channel of its own, `dialog:save-changes`, rather than
  on a widened `confirm` or on a generic "draw me these buttons" message — the renderer never sees a
  button index, because main builds the button order and reading an index back belongs where the
  order is. ADR 0034 records that and the three other decisions inside this card; ADR 0031's staging
  and its deadlines are untouched, and its unbounded wait is what makes a quit with three file
  pickers in it possible at all.

  Also here, because the quit question needed it: a failed save is now an answer rather than a
  re-thrown exception, and the line in the log is written directly. The sentence in the problems
  panel is unchanged.

- b1fc1c2: TYTO-154 — the export end-to-end suite went red at random, and the cause was a command the
  window silently refused rather than anything about exporting.

  **What was happening.** The suite waited for `.shell` before driving the app. `.shell` is in
  `index.html`, so it is on the page before a single line of the renderer has run — it was a wait
  for nothing. The suite then ran `editor.open` through the command bar, and two gates decline a
  command that early: the bar's `run` is a no-op until the window has finished loading, and
  `runCommand` answers `false` for as long as the editor is not mounted. Both decline in silence,
  which is right for a person clicking a button that cannot work yet and useless for a test. The
  open never reached main, the file picker was never opened, and the next line waited thirty
  seconds for text that was never coming.

  **Measured, on Windows, against the built app.** The editor mounts **32-80 ms** after `.shell`
  exists (6 launches). A probe firing the command at `.shell` lost that race in **2 of 6**
  launches, and in both of them the editor was not mounted at the instant of the click; the same
  probe waiting for the editor won it **6 of 6**. The flake reproduced here on the **second**
  consecutive run of the unchanged suite, at the line the card recorded.

  **The trigger is machine load, which is why an idle loop is the wrong instrument.** With the old
  wait left in place the suite went 8 of 8 green on an idle machine and then red on the **4th** run
  with six CPU-burning workers alongside it. The fixed suite under that same load: **6 of 6 green**.
  That also explains the card's own asymmetry — 1 red of 2 on a CI runner, 2 of 8 here with both
  reds first and back to back.

  **The fix is in three parts.**

  - The suite waits for `#editor .cm-content` and `.tabs__tab`, which is what the other thirteen
    suites already wait for. That closes the race.
  - `CommandBar.run` now answers whether the command actually ran. The registry always knew; the
    answer was thrown away at the call site. The suite's helper checks it and fails immediately
    with _the command bar refused 'editor.open'_ instead of waiting thirty seconds for a
    consequence that cannot happen.
  - When the wait does expire, the failure now names the stage: the tab labels, whether the editor
    is mounted, and the first 120 characters of the viewport. A tab named `promo.brief` with an
    empty viewport means main answered and the drawing is the problem; an untitled tab means the
    open never came back from main. `.cm-content` holds the viewport and not the buffer, so the
    tab label is what tells those two apart.

  Nothing about a timeout was raised. The 30 s was never the problem, and a bigger number would
  have made the red runs slower rather than rarer.

  Also here, one line of it: `e2e/close-app.ts` said it answers the quit box's _confirm_ button at
  index 1, which was true of the two-button box TYTO-153 replaced. Index 1 is _Não_ now — the same
  act, a different name — and the comment says so rather than leaving the next reader to find it.

- Updated dependencies [91b6bc5]
  - @tyto/brief-lang@0.6.1
  - @tyto/core@0.22.1
  - @tyto/editor@0.6.1
  - @tyto/io@1.3.2
  - @tyto/plugin-api@0.3.4
  - @tyto/pipeline@0.7.2
  - @tyto/export-html@0.5.4
  - @tyto/export-svg@1.2.2

## 0.3.1

### Patch Changes

- c45e3b8: TYTO-147 — quitting with unsaved tabs now waits for you to answer the box, however long you take,
  instead of taking your work two seconds after showing it to you.

  The quit question was guarded by a single two-second timer, and when it fired it did not cancel the
  question — it _was_ the exit. The box that asks is drawn by main with `dialog.showMessageBox` and
  the window sends its answer only after somebody clicks, so what those two seconds bounded was never
  a renderer computing anything. It was a person reading. Anybody who read the box before choosing
  lost every unsaved tab at the two-second mark, which is the ordinary case and not a rare one.

  The wait is in two stages now. The window acknowledges the question on a new `app:exit-ack` channel
  as the first thing its listener does — before it counts unsaved documents and before anything is
  drawn — and a deadline bounds that acknowledgement and nothing else. After the acknowledgement
  there is **no deadline at all**, because the thing on the other end is a person.

  **And when that deadline runs out, the app stays put.** It does not quit — it drops the attempt
  and leaves you in the window with your text. The box is a warning, and the only person entitled to
  trade a document for a closed app is the one reading it: close the app by accident, walk away for a
  glass of water, come back, and your work is where you left it. Nothing in here decides that for
  you any more.

  That is a reversal of what ADR 0029 wrote down, and it has a price that is stated rather than
  hidden: a window that is frozen but still alive can no longer be quit from inside the app, and
  ending it is the operating system's job. A crash, a closed window and a reload are all still
  handled — a page that is gone has no text left to protect.

  The deadline itself is thirty seconds, and two smaller numbers were tried first: two shipped and
  quit, five cleared a measured end-to-end flake at ~2.02 s and still quit. Once the clock stopped
  deciding, being generous with it became free — no length of it can cost a tab — and a unit test
  now pins the number so it cannot drift back to a guess on a green suite.

  What ends the unbounded wait when the page that was asked goes away is a hard check and not a
  second, longer timer: a crash, the window closing and a reload all release the exit. The reload is
  the one worth naming — it keeps the renderer process and throws away the page holding the question,
  and without it a single reload with the box up left an app that could never be quit again. A second
  number would have been picked the same way the first one was, and a dead renderer's unsaved text is
  already gone, so holding the app open would protect nothing. ADR 0031 records that, the rejected
  alternative, and the one counter-argument — an OS logoff is now bounded by the OS rather than by us.

  **Correcting the 0.3.0 entry below rather than rewriting it.** That entry says "a renderer that
  never answers holds the app open for two seconds and then the exit proceeds", and ADR 0029 said the
  same. Both name the wrong case: the timer was not catching wedged renderers, it was catching
  readers. The published note is the shipped record of a version that was built and tagged, so it
  stays as history and the correction arrives here, where it is auditable; ADR 0029 carries the same
  correction as an amendment, in the form ADR 0027 already uses.

  No test in the repository could see any of this, because every one of them replaced the box with an
  already-resolved promise and answered in microseconds. There is now an end-to-end case that takes
  four seconds to answer and looks at the app at three — the only test here that fails against the
  shipped behaviour.

- 8d673c6: TYTO-148 — an export that cannot capture a frame now says so and finishes, instead of sitting at
  eleven frames of twelve forever.

  Nothing in the desktop's capture path had a clock. The five steps between `loadFile` and
  `Page.captureScreenshot` were awaited without a deadline, and both cleanups — the hidden window
  and the temp folder — sit in `finally` blocks that a never-settling `await` never reaches. So one
  stalled frame took the window, the folder and the whole run with it.

  It is not hypothetical and it is not rare. Measured on win32 across 100 captures with an 8 s cap on
  each, the packaged app failed to answer `Page.captureScreenshot` on **15 of 80** across four
  packaged shapes — 19%, and 4 of 20 in the shape that ships — while the dev build answered 20 of 20.
  Four suspects died in the same table: not the fonts wait (the per-step probe timed
  `document.fonts.ready` at 0–2 ms on every capture, the ones that then hung included), not asar
  packing, not the GPU, not a 0.2.0 → 0.3.0 regression. Every capture that did answer answered in
  39–1 075 ms.

  Every step now has a **30 s deadline** — ~19× the slowest capture ever measured (1 609 ms), and the
  same number Playwright's adapter already lives under — and a capture that misses it is retried once
  on a fresh window. The deadline is per step so that the failure names the command that stopped
  answering, because that name is what the export report carries.

  **What this does not do, stated plainly: the retry does not recover every hang.** That residual has
  now been measured at the deadline that actually ships, which nothing in this card had done — 40
  captures against a package rebuilt from `main`, a 30 s cap on all five steps, win32, one machine
  (TYTO-152, 2026-09-19). **8 of 40 first attempts never answered, the retry recovered 7 of them, and
  1 of 40 — 2.5% — still failed.** The 8 s probe had put that residual at 6 of 80, roughly 7%; the
  shipped deadline's own number is the smaller of the two and both samples are small.

  **The same run closes the gap this paragraph used to declare open, and it closed against the
  hopeful answer: 0 of 40 captures answered between 8 s and 30 s.** The extra patience buys nothing —
  a capture that passes ~1.1 s does not come back at all — so the 19% was never an artifact of the
  probe's cap, and the hang rate at the shipped deadline is the same 8 of 40. What changes is that
  those frames fail as a reported failed frame, with the frames that worked written to disk and named
  in `result.json`, and the run reaching an end. Why a packaged build hangs where the dev build does
  not is a Chromium-level question this card localised and did not answer; it has a follow-up of its
  own in TYTO-152, and the deadline does not explain it.

  ADR 0030 records the decision and corrects ADR 0027, whose Consequences predicted the wrong failure
  mode — an `attach` collision — and said it was not measured. It is measured now, and it was the
  other command. ADR 0030's own Consequences still quote the 8 s probe's residual and its 28× margin,
  because an ADR is amended by another ADR and not by a changeset; TYTO-152 carries both numbers and
  is where that amendment belongs.

- b586614: TYTO-149 — the app writes one line when it starts, so the log folder a beta tester is asked for
  exists from the first run instead of only after something has already been written down.

  The whole beta support story is _if something breaks, send me the log folder_: it is in the
  release body, it is the one item in the Help menu, and TYTO-140 ships a crash box whose job is to
  name it. `fileLog` creates its folder on the first write and not before, which is the right
  behaviour on its own — a log that needed somebody to create its own folder would write nothing on
  the machine it matters most on. The consequence was that the folder was missing after exactly the
  failure that needs it most. An app that starts cleanly and then hangs has logged nothing, so
  Help ▸ _Open the log folder_ opened nothing, and a tester following the release body found a path
  that was not there and had nothing to send.

  Measured on the shipped 0.3.0 portable rather than read off a config file — launched from
  `release/win-unpacked` and left running, with `Local State`, `Preferences` and `blob_storage`
  touched under `%APPDATA%\@tyto\desktop`, no `%APPDATA%\Tyto` in existence, and no `logs/` folder
  at all.

  The line carries the version, the platform and a timestamp, which is what dates the session a
  report is about. It does not reopen the synchronous-write trade `log.ts` defends: one write per
  process launch, before a window exists.

  `docs/releases/desktop-v0.3.0.md` now says plainly that on that version a missing `logs` folder is
  itself the answer — the app stopped before it could write anything — because that release is
  already in testers' hands and this change cannot reach it.

- 9a38c07: TYTO-150 — every version of the app now keeps its data in its own folder, so a build you download
  cannot open with the one before it still in it.

  Until now the packaged portable, the installed build and `electron-vite dev` all wrote to a single
  folder per machine, which is the opposite of what the `portable` target exists for: a build meant
  to run beside another version of itself opened with that version's layout, recent files and
  settings, and a tester could not tell the behaviour they were looking at from residue. The data
  now lives in `<appData>/Tyto/<version>/` — `%APPDATA%\Tyto\0.3.0` on Windows,
  `~/Library/Application Support/Tyto/0.3.0` and `~/.config/Tyto/0.3.0` on the other two — and the
  five things that folder holds (logs, settings, recent files, credentials, layout) move with it.

  The product root is a literal and not `app.getName()`, which settles the question TYTO-149 opened.
  `getName()` answers with the package name, `@tyto/desktop`, while electron-builder ships
  `productName: Tyto` — read out of the shipped 0.3.0's `app.asar` rather than off a config file —
  and that is how a release body could send beta testers to `%APPDATA%\Tyto\logs` while the app
  wrote to `%APPDATA%\@tyto\desktop`. A test reads `electron-builder.yml` so the two cannot drift
  apart again. `docs/releases/desktop-v0.3.0.md` is corrected to the folder the shipped 0.3.0 really
  uses rather than to this one, because it describes a binary people already hold.

  The path is set at module scope, before `app.whenReady()`, and that is measured rather than
  stylistic: moving it after ready leaves a Chromium `Local State` file behind in the old folder.
  `--user-data-dir` is honoured wherever it is passed, which is what keeps fourteen end-to-end
  suites isolated from each other.

  Anybody on a version before this one keeps their data where it is, and nothing here reads it.
  Bringing settings across from the previous version is the next card, and the auto-updater waits on
  that one: an update that silently moves somebody into an empty folder is worse than no update.
  Credentials are part of what does not travel — `safeStorage` ciphertext lives in the folder that
  moved, so a new version asks for them again.

  Decided in ADR 0032.

- 46f99f4: TYTO-152 — the export stops losing frames in the installed app: a capture that used to hang forever
  now answers every time, because the window it is taken on is one Chromium actually draws.

  TYTO-148 measured the hang and contained it with a deadline; it did not explain it, and said so.
  The explanation is that `show: false` hides a window without making it offscreen.
  `Page.captureScreenshot` asks for a frame of that window's **surface**, and in the packaged app
  nothing composes a surface for a window nobody can see — so the frame turns up about a second late,
  or never. The window now uses `webPreferences.offscreen: true`, which is a different mechanism:
  Chromium produces frames into a bitmap on its own clock, screen or no screen.

  Measured on win32, the packaged app rebuilt from this change, 20 captures per arm, round-robin:

  ```
  arm      hangs   fast(<500ms)  ~1s(>=500ms)  latency
  before   6 / 20       4             10       75–1550 ms
  after    0 / 20      20              0       63–128 ms
  ```

  The ~1 s cluster disappears with the hang, which is what says they were one mechanism. Across
  everything this card measured without the fix, 18 of 80 packaged captures hung (22.5%); with it,
  0 of 20 here and 0 of 20 in the arm that first tried it. Four more suspects died on the way: not
  background throttling (6 of 20), not the window's transparency (3 of 20), not the test harness
  hiding the main window (5 of 20 with it visible — the shape a person runs), and not the request
  itself — `fromSurface: false` hung 20 of 20 and forcing a frame with `Page.startScreencast` hung
  20 of 20 after its own frame had arrived in under 100 ms every time.

  **What changes in the picture, stated rather than discovered later: text is antialiased slightly
  differently**, because offscreen rendering composites in software. Against the Playwright
  adapter's references, the desktop's output moved _closer_ on both fixtures that were not already
  identical — `shapes.feed` 0.0656% → 0.0219% and `text.feed` 1.2219% → 1.0613% — and `alpha.square`
  stays byte-identical. The desktop's own `text.feed` reference, which is a regression check, was
  re-recorded: the diff is glyph-edge pixels with no layout shift.

  **The 30 s deadline from TYTO-148 stays.** No hang on one machine, on one platform, in one build is
  not the same as no step ever stalling, and the deadline is what keeps the next one legible.

  ADR 0033 records the decision, amends ADR 0027's window and supersedes the measurements in
  ADR 0030 — including its residual: at the deadline that actually ships, 8 of 40 captures hung, 0 of
  40 answered anywhere between 8 s and 30 s, and the retry left 1 of 40 failing rather than the ~7%
  that ADR quotes. **Why a packaged build differs from the dev build at all is still not named**, and
  the fix does not depend on the answer.

## 0.3.0

### Minor Changes

- b8811de: TYTO-122 — point the app at a folder of your own templates.

  The CLI needed no flag for this: a `templates/` folder beside a brief has been searched before
  the built-in pack since ADR 0020. The window had no such door — it was hard-wired to the two
  templates the app ships, so anybody with a template of their own had to leave the app and use
  a terminal.

  Now there is a setting. Choose a folder, and it is searched **first**: your `promo-curso`
  shadows the built-in one, and the built-in ones you did not name are still there. The picker,
  the preview and the export all see it — all three, with nothing rebuilt — and clearing the
  choice goes back to the built-in pack with no restart. It survives a restart too, in
  `settings.json` beside `layout.json`. The footer says which folder is in force.

  A folder that turns out to hold no templates is reported in the problems panel and does not
  take the built-in pack down with it. The folder's own `formats.yaml` replaces the built-in
  one when it has one, and falls back when it does not — so a folder that is only templates
  does not have to carry a formats file to work.

  What it does not do: it does not install a template from a published package, and it does not
  notice somebody editing that folder while the app is open.

- a193362: TYTO-123 — quitting with unsaved tabs asks first, and a no keeps the app open.

  Closing a single tab with unsaved text already asked. Closing the window asked nothing: every
  open tab went, unsaved ones included. Both doors are now guarded — the window button and
  `Mod-W` through `BrowserWindow.on('close')`, Cmd+Q and the dock's Quit through
  `app.on('before-quit')` — sharing one latch, so one click produces one question. The box names
  how many tabs would be lost, in the window's own language, with the cancelling button as the
  default.

  This is also the card that gave the app its first main→renderer message (ADR 0029). Main could
  answer before; it could not speak first. There is now a second table, `IPC_EVENTS`, one-way,
  and the rule that **a push carries no reply** — when an answer is needed it comes back on an
  ordinary request channel. `export:progress` keeps polling on purpose: progress is state a
  dialog reads, not a question that needs answering.

  One case still loses work, deliberately: a renderer that never answers holds the app open for
  two seconds and then the exit proceeds. An app that cannot be closed is worse than the loss it
  would have reported, and ADR 0029 records the trade.

- c3e1a4a: TYTO-124 — the File menu carries the app's own verbs, there is a New, and a save that fails
  says so.

  Three things a person meets in the first five minutes, which is why they were one card.

  **The File menu.** It used to be `{ role: 'fileMenu' }`, whose entire content on Windows and
  Linux is Quit — and on macOS is _Close Window_ on `Mod-W`, the one accelerator this app removes
  on purpose, so macOS had no File menu at all. Open, Save, Save as and Export all existed and
  answered only to `Ctrl+K` or a keystroke somebody had to already know. They are now in the menu,
  on all three platforms, each one running **the same command the command bar runs**: the ids live
  in one table both processes read, main sends the id across and the renderer calls the registry.
  Nothing in the browser process knows what any of them does.

  **New.** There was no such verb. The only way to reach an empty tab was to close the last one and
  let the window replace it — a side effect standing in for a command. `Ctrl+N` and File ▸ New now
  add a tab without disturbing any other; the rule that lets an empty untitled tab be replaced when
  you open a file is untouched, and deliberately not consulted here, or a New pressed on a blank
  tab would open nothing.

  **A failed save.** A rejected write — full disk, read-only folder, a path that vanished — became
  an unhandled rejection: a line in a log file, and on screen nothing but the unsaved dot, which
  was already lit and so said nothing new. It is now a row in the problems panel naming the file
  and the reason the system gave, in the window's language. The panel rather than a dialog,
  because that is where _why is this not working_ already goes and because the quit question is
  meant to be the only box that interrupts.

  Two smaller consequences. The menu is **rebuilt when the footer changes language** — it was built
  once in the system's locale, which cost one wrong word when it carried one string and would cost
  five now. And **no File item carries an accelerator**: a menu accelerator is handled before the
  page sees the key, so one there would fire in vim mode too, where `Ctrl-N` and `Ctrl-O` belong to
  the vim engine.

  What it does not do: no right-click menu, no recent-files list inside the menu, and a save that
  failed is not retried on its own.

- 75669b0: TYTO-132 — the app writes down what broke, so a beta report is not somebody's memory.

  The desktop wrote no log at all. A render that threw, a preview that never answered and a save
  that failed each left the process with nothing on disk, so a tester who hit something could only
  describe it afterwards. There is now a rolling file in `userData/logs/`, a line per failure
  naming what broke, when, in which version and on which platform, and a Help menu item that opens
  the folder — a person reaches it without being told a path.

  Four things now write to it: an uncaught exception or unhandled rejection in main, an IPC handler
  that rejects, an export whose render died, and a failure in the window (through a new `log:write`
  channel). The plugin host's own log, which until now dropped everything, goes to the same file —
  so a built-in that fails to activate stops vanishing.

  **It stays on the machine.** Nothing is sent anywhere, and that is not a switch somebody turned
  off: ADR 0011 plus a dependency list with no network client in it leaves nowhere for it to go.
  Anything that phones home needs an ADR first. The file also carries no brief text and no file
  contents, enforced by length caps on the channel rather than by the discipline of the call sites.

  Two consequences worth knowing: the file is capped at half a megabyte across two generations, so
  the oldest entries are dropped rather than archived; and Electron's own crash box for an uncaught
  exception in main is replaced by a log line, because installing a listener takes that over.

- e308855: TYTO-133 — the desktop can turn artwork into image bytes.

  `createDebuggerRasterizer` implements the `Rasterizer` port on a hidden `BrowserWindow`
  captured through `webContents.debugger` (ADR 0027), registered through the plugin host under
  the same `chromium` id the CLI uses for its Playwright one. All three formats the port
  promises come back with the right container, and `scale` reaches the pixels rather than the
  layout.

  A `minor` and not a `patch`: nothing the window does today changes, but the app gained a
  capability it did not have, and the next card is the one that puts a button in front of it.

- bb08c00: TYTO-136 — a `desktop-v*` release now carries a portable Windows build beside the installer.

  Windows was the only platform whose artifact could not be run without installing: Linux ships
  an AppImage and macOS a `dmg`, both of which already give you something runnable. The
  `portable` target adds one self-extracting `.exe` that runs from wherever it sits — measured
  at 112 216 510 B beside the installer's 112 383 465 B, from the same 390 134 058 B tree, with
  no filename collision (`Tyto 0.2.0.exe` against `Tyto Setup 0.2.0.exe`).

  macOS and Linux are untouched, and `desktop-release.test.ts` now pins all four targets, so
  dropping the portable and quietly giving another platform a second artifact both fail.

- 60f0256: TYTO-140 — a crash says so on screen again, and for the first time when it happens at startup.

  The log card traded a box for a line without meaning to. Electron draws its own error box for
  an uncaught exception **only while nothing else is listening**, and `installCrashHandlers`
  started listening — so a crash in main became something written down and invisible. Measured
  this time rather than read: Electron's default handler opens with
  `process.listenerCount("uncaughtException")>1||…`, dumped at runtime from the Electron this
  repo installs.

  `installCrashHandlers` now takes an `onCrash` port and the composition root supplies
  `dialog.showErrorBox`, which keeps `log.ts` free of Electron and unit-testable. The box carries
  the error's first line and **the path of the log folder**, because that folder is what a tester
  is asked to send. It is called inside a `try`: it runs where a raised exception is fatal, and a
  box that failed to draw would turn a reported crash into a silently killed process — worse than
  the state this started from.

  **The bigger half is the one the card's title does not say.** A `throw` during startup is a
  rejected _promise_, and Electron runs with `--unhandled-rejections` in `warn` mode, so that path
  never reached Electron's box — before the log card or after it. It is also the path that has
  actually failed in a packaged app, and what it looks like is a double-click that does nothing:
  no window, no box, a process alive and invisible, and a log line sitting in a folder whose only
  door — Help ▸ Open the log folder — was built last, after everything that can fail. Two changes
  close it: a `.catch` on `app.whenReady().then(start)`, and the application menu built **first**,
  before the settings, the sources, the preview, the catalogue and the export. The menu needed
  none of them; it only needed to be asked earlier.

  The box follows the window's language rather than the system's, over the channel the File menu
  card added. Three catalogue strings arrive with it, one of them for the case where `fileLog`
  itself failed — a box naming a folder that was never written would send somebody looking for a
  file that is not there.

  What it does not do: it does not prevent the crash and it does not recover what was open. It
  makes sure the person knows it happened and has something to send.

- b06f3fd: TYTO-43 — the window exports.

  An export dialog with a destination folder, file types, a progress bar, cancel and "open
  folder", running the same `runJob` the CLI runs. Measured rather than asserted: the same
  brief rendered through the window and through `tyto render` produces byte-identical
  artifacts (`e2e/export.desktop.test.ts`).

  Progress is polled rather than pushed. Every channel in `shared/ipc.ts` is a question with
  an answer, and the one-way main→renderer message a push would need is the transport TYTO-123
  has to design for its quit confirmation — so this card asks instead of deciding that for
  another card.

## 0.2.0

### Minor Changes

- bf4b0b9: TYTO-103 — the command bar, over the registry the editor already shipped

  `@tyto/editor` has had a command registry since E8.3, with a comment saying the order of
  `list()` is the order a palette should show. Nothing in `apps/desktop/src` had ever named
  `createCommandRegistry`. This wires it and puts a bar in front of it.

  **`Mod-K` opens a list of everything the window can do**, filtered as you type, with the
  keystroke beside the commands a keymap binds. Enter runs, Escape closes, the arrows move and
  wrap, and focus goes back where it came from. Matching folds accents and case and looks at
  the id as well as the label, so `previa` finds "Prévia: aumentar" and `preview.zoomIn` finds
  it while the window is in the other language.

  **Eleven commands**: undo and redo, which the registry brings itself; the five preview
  commands, the two slide commands, and — reachable for the first time — the locale switch and
  the vim toggle, neither of which any keymap binds. That is what a palette is for: the locale
  switch was a `<select>` in the footer and nothing else could reach it.

  **The zoom buttons now run commands rather than doing the work.** A button, a key and a bar
  entry are three ways to say one id, and a handler that did the work in the click listener
  would be a fourth definition of "zoom in" for the others to drift away from.

  Two details worth naming. The opener is a window listener and not a CodeMirror binding, so
  the bar opens with the preview focused, the panel focused or nothing focused at all — an
  unhandled keystroke in the editor bubbles out to it anyway. And **no desktop command
  declares an `undo`**, though the registry would take one: `Mod-z` is a single stack shared
  with the text, and a zoom on it would sit between two keystrokes somebody is trying to take
  back.

  The editor now receives the registry, which makes `Mod-z` the registry's undo rather than
  CodeMirror's — an app-level command on top of the stack comes off before the text under it.
  Thirteen catalogue keys arrive with the bar, and `window.desktop.test.ts`'s pin of "keys that
  are not an element's text" grows by all thirteen: a component translates inside its own
  render, so its strings never reach the `[data-i18n]` pass that test counts (ADR 0024).

- 2933a71: TYTO-42 — a problems panel, a template picker and an artwork list that move the editor

  Three panels, and what they share is that each one connects something the window already
  knew to somewhere in the brief.

  - **A problems panel under both panes**, listing every diagnostic with its severity, its
    code, its message and the line and column it points at. Clicking one selects that exact
    range in the editor, scrolls it into view and focuses it — the range travels as the offset
    pair the parser produced, so nothing converts it on the way. A diagnostic about the
    project rather than about a span of the brief is listed and is not a button, because there
    is nowhere for it to take you.
  - **A template picker** over the editor, reading the registry's manifests — name,
    description, formats, and a `preview.png` when a template ships one. Choosing a template
    rewrites the frontmatter's `template:` line as an ordinary editor edit, which is what makes
    the preview, the panel and Ctrl+Z all work with no second code path. A brief with no
    frontmatter gains one.
  - **The artwork list is driven by the brief's artworks, not by the frames on screen.** A
    slide that renders to one format only used to vanish from the list when the other tab was
    picked. Selecting a slide now also scrolls the editor to the `::directive` that created it.

  `brief:preview` gains an `artworks` list carrying each artwork's source range, which is the
  one thing a frame cannot carry: a `Scene` has no source position, so the number is picked up
  in `resolve` and passed forward. `templates:list` is a new channel. A folder that meant to be
  a template and could not be read as one now reaches the panel as the registry's own
  diagnostics — nothing said so before, because the preview service replays the registry's
  warnings and those failures are not among them.

  The panel sizes to its contents up to 30vh and scrolls past that. It was a flat 168px until
  the window was opened and measured: a clean brief reserved all of it to say "nothing to
  report", and the preview fitted a 1080×1080 frame at 32% instead of 44%.

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

- 9c82657: TYTO-109 — the search panel speaks the window's language

  Twenty-three catalogue keys arrive with find and replace: seventeen for the panel itself and
  six command labels. `src/renderer/search-phrases.ts` maps each of CodeMirror's own keys — the
  English string _is_ the key, so a missing entry falls back to itself and shows English on a
  Portuguese screen — to a catalogue key, written out rather than derived.

  `applyLocale` in `main.ts` replaces two call sites that set `state.locale` and repainted.
  Everything this app draws is re-read by `repaint`; the panel is not, because it is
  CodeMirror's DOM, so the editor is told separately.

  `NOT_ELEMENT_TEXT` in `e2e/window.desktop.test.ts` grows by all twenty-three, its largest
  single growth. The coverage it gives up is replaced twice: `search-phrases.test.ts` holds
  every key to a catalogue entry that differs between the two languages, and
  `packages/editor/src/search.test.ts` mounts the real panel and reads the words back off it.

  **This was a second file rather than a second line in the editor's changeset**, and at the
  time that was not style. Changesets v3 treated a private package as _ignored_ and refused a
  changeset naming an ignored and a published package together — `Mixed changesets that contain
both ignored and not ignored packages are not allowed` — after one file naming both took the
  release workflow down on `main` (TYTO-0). TYTO-94 turned private versioning back on, so the
  refusal has nothing left to refuse and one file is fine again.

- 243d596: TYTO-108 — the artwork stays on screen when the brief stops compiling

  Typing a stray character used to blank the preview, at the one moment the preview is the
  thing telling you whether the fix worked. Now the artwork stays and says it is older than the
  text being written.

  **The marker is the feature; keeping the pixels is the easy half.** A preview that silently
  showed old art would answer "did my fix work" with yesterday's answer. It reads as a state of
  the pane rather than as a second error message — the problems panel already lists what is
  wrong — and it sits inside the preview stage so that it is legible with that panel closed,
  which is the case this card is about.

  **Derived, not stored.** `DocumentState` gains `renderedBrief`, the text the current frames
  came from, and `isStale` is `frames.length > 0 && renderedBrief !== brief`. There is no flag
  for one code path to set and another to forget: a compile that starts working again clears the
  marker on the answer that fixes it. A brief that has never rendered is empty rather than
  stale, which is the case a boolean would get wrong on a new tab.

  **The discriminator is the errors, not the empty list.** A brief that compiles to nothing is a
  legitimate answer and clears the pane; frames are kept only when the compile actually failed.

  What it deliberately does not do: render partial output — that is TYTO-107 — keep frames
  across a reopen, or change what `brief:preview` sends.

- b5c689b: TYTO-99 — open and save `.brief` files, and the folder that comes with one

  Until now the Tyto window could compile a brief and show it, and could not keep it: close
  the app and the text was gone. This adds opening, saving and a recent list — and, because a
  file has a folder, it is also what makes a brief's images appear.

  **Main holds the path and the renderer never does.** The renderer asks to open something and
  gets back text and a name; where the file is stays in main, which is the only side with a
  disk. That is not ceremony: it is what lets the preview resolve `assets/logo.png` without the
  renderer ever learning a folder. The one place a path crosses the bridge is a recent entry,
  and main refuses any path that is not already in the list it wrote — so a renderer asking for
  a file nobody offered gets the same answer as one asking for a file that was deleted.

  **The recent list is commands, not a menu.** E9.12 built the list a person types into; ten
  files are ten entries in it, reachable with `Mod-K` and no panel open. An entry whose file has
  moved is reported in the problems panel — the same place every other "why is this not
  working" already goes — rather than vanishing on the one click that would have explained it.

  **Images start working, and that took two ports rather than one.** Resolving told `resolve`
  that `assets/logo.png` exists; the exporter still had nothing to embed and reported
  `E_EXPORT_ASSET_UNRESOLVED` for a file that was right there. Reading the bytes between
  `compile` and the export is the other half, and the end-to-end suite is what found it.

  `Mod-s` finally does something: `@tyto/editor` has bound it to `editor.save` since E8.3 and
  no host had registered the command. `Mod-o` and `Mod-Shift-s` are the desktop's own
  additions — and deliberately **not** offered in vim mode, where `vimMode()` replaces the
  whole input layer, so the command bar shows no shortcut for them there rather than promising
  one that does nothing.

  The window title carries the file name and says `(não salvo)` in words rather than with a
  bullet, which is nothing at all to a screen reader.

- f7afdf7: TYTO-100 — Lit for the renderer, and a window whose layout can become data

  The framework question had been pushed twice with nobody owning it. It is answered in ADR
  0024, with the problems panel rebuilt on the answer so that the decision ships as code and
  not only as a document.

  **What was measured, and what it said.** A repaint costs 4.9 ms today and 9.3 ms with ten
  panels in the window, inside a 16.7 ms frame — so nothing about speed forces a framework at
  the size being planned. The `[data-i18n]` walk, which the card named as the worry, is 1 % to
  5 % of that; the cost is `stageBox()` forcing a synchronous layout after the other painters
  have dirtied the document. What does force the change is that a panel today is a `<div>` in
  `index.html` plus a `getElementById` plus a bespoke painter, and none of those three can be
  written down as a record — which is what a window with panels a person shows, hides and
  resizes needs a panel to be.

  **Lit, over Preact and over staying hand-written.** The same panel built three ways: changing
  one diagnostic of two hundred costs 1.62 ms hand-written, 1.11 ms on Preact and 0.14 ms on
  Lit, and both component models keep the DOM nodes of the rows they did not change where
  `replaceChildren` could not. Lit also needs no build knob — no JSX transform in the three
  configs that declare this package's two-runtime split — and renders into light DOM, so
  `shell.css` still reaches inside every panel.

  **`<tyto-problems>` replaces `paintProblems`.** It owns its own strings, so changing the
  locale is a property change rather than a second pass over the document, and it hands a
  clicked row's range straight to the callback — the two `data-range-*` attributes and the
  `closest()` that parsed them back out are gone. Rows are keyed by the diagnostic's code and
  span and never by index, so fixing one error does not repaint the ones below it.

  **The renderer will not run in a browser tab.** Five comments said it would; ADR 0024 retires
  that premise and says what replaces each of them. A template's `preview.png` still crosses
  the bridge as bytes and `window.tyto` is still optional, for reasons that never depended on
  it. The window still has a browser tab's powers and not a Node process's, and the pure
  packages still run in any runtime — those two are untouched, and they are the ones that
  actually make the cloud possible.

  The bundle grows 24.8 kB, or 2.3 %, on a renderer CodeMirror already dominates.

- d8a2264: TYTO-115 — the workspace owns the text, which is what unblocks two cards that could not be
  written

  Nothing on screen changes, and that is the acceptance criterion rather than a disclaimer:
  `pnpm --filter @tyto/desktop test:desktop` passes with no test edited and none added, 76 of 76.

  **Five call sites used to ask CodeMirror what the document said** — the template picker's
  repaint, the save, the picker's `change` handler, the debounced compile and the first compile
  on load. Each of them was therefore an answer only the _active_ document could give, because
  `DocumentState.snapshot` was a copy refreshed when a document stopped being active and stale
  on purpose for exactly as long as it was in front. All five read `activeText()` now, and the
  recount is **0 of 5** left reading the pane. `panel.ts`'s `view.state.doc.length` stays, and
  is not one of them: clamping a range before revealing it in a viewport is the view's own
  question.

  `DocumentState.snapshot` is replaced by two fields that are not the same thing.
  `state` is the document — text, undo history and cursor — written by an `onUpdate` listener
  on every transaction. `scroll` is where the pane was looking, still captured at a hand-off,
  because scroll belongs to the view and two views on one document scroll independently (D7),
  and because reading it costs a layout flush that a keystroke should not pay.

  **Why this is a card of its own**, against the exploration's advice to fold it into a
  feature: it is behaviour-preserving and its evidence is silence, while TYTO-112 deliberately
  inverts an end-to-end expectation. Done together, nobody could tell which half moved that
  test.

  What it does not do: derive the unsaved marker (TYTO-112, which this unblocks), restore a
  session (TYTO-113), or allow a second editable view on one document (D2).

- 06dc650: TYTO-101 — the dock: a panel is a record, and a person can show, hide and resize it

  The window used to be a room with the furniture nailed to the floor. `index.html` declared
  an editor on the left, a preview on the right and a problems panel underneath, and `main.ts`
  held fifteen `getElementById` calls resolved before anything was on screen — which is exactly
  what stopped a panel from ever having a position that could change.

  **Now nothing in the markup says where a panel goes.** `index.html` declares four empty docks
  and a splitter each; `shared/layout.ts` holds one entry per panel — which element, which
  dock, open or not, how wide — and the dock builds the window from it. Adding the templates
  list or the queue is an entry and an element, with no change to the dock, the stylesheet or
  the window. The left dock is already there and empty for exactly that reason.

  **What a person gets:** a close button on every panel that has one, the same panels back from
  the command bar (`Mod-K`, "Mostrar ou esconder: Problemas"), and a splitter to drag between
  any two docks. All of it is remembered — close the problems panel, drag the preview wider,
  quit, reopen, and the window comes back the way it was left. "Restaurar a disposição padrão"
  is a command rather than a button, so it is reachable with every panel shut, which is when it
  is most needed.

  **The editor cannot be closed, and that is a field rather than a rule.** Closing its panel
  unmounts CodeMirror and destroys the buffer; E9.8 gave it somewhere to save to but nothing
  asks before discarding, and there is still no second tab to keep it in. When either lands,
  `fixed: false` is the whole of the change.

  Two things were found by opening the window rather than by a test, which is now the fourth
  time on this app. Sixty-four pixels of dead space between the panes and the bottom dock,
  because the shell's own 24px gap was still being added on both sides of a 16px splitter. And
  `Mod-K` stopped opening the command bar after the first time a panel was closed: the window
  listener was being registered again on every rearrange, so two of them toggled the bar twice
  inside one keystroke and it never appeared.

  The repaint measurement from ADR 0024 was re-run against the real panels and the ADR now
  carries both numbers. The conclusion holds — the forced layout is the expensive half and the
  `[data-i18n]` walk is not — and the magnitudes were overstated: the synthetic document had
  944 elements where the real window has 115.

### Patch Changes

- @tyto/io@1.3.1
  - @tyto/pipeline@0.7.1
