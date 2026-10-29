# @tyto/plugin-api

## 0.9.0

### Minor Changes

- e7588e9: TYTO-440: a plugin file's configuration sets the brief's side under `brief:` (ADR 0151). `slots` fills a slot that does not repeat when the brief leaves it unset, `formats` says what renders when the brief lists none, `skeleton` keeps the text a new brief starts with, and `editor` sets a `max` per slot, tighter than the manifest's. The brief wins every one. `@tyto/plugin-api`'s `parsePluginFile` keeps the block with each part's range (`PluginFileConfiguration.brief` is now a `ConfigurationBrief`), and warns on a key that is not one of the four. `@tyto/core`'s `resolveTemplateConfigurations` checks it against the manifest once and hands it on as `TemplateSelection.brief`; `resolve` applies it. New warnings: `W_CONFIGURATION_BRIEF_INVALID` and `W_EDITOR_RULE_LOOSER` at the plugin file's line, `W_SLOT_OVER_CONFIGURED_LIMIT` at the brief's. Nothing crosses to a plugin's process, so the protocol is unchanged. The manual's Plugins page describes it in both editions.
- 4388575: TYTO-455 (ADR 0155): a plugin file's configuration picks its brand, and the brand kit carries the brand's accent. A configuration may write `brand:`; the template is then handed that brand's kit in `context.brand` instead of its manifest's — the configuration's own brand, else its entry `default`'s, else the manifest's. A brief cannot name a brand. `@tyto/core`'s `BrandKit` gains `colors?: { accent? }` (`BrandColors`, `brandColorsSchema`; closed and strict, a hex accent only), `TemplateSelection` and `ResolvedBrief` gain `brand`, `resolveTemplateConfigurations` takes optional `kitBrands`, and two warnings join: `W_CONFIGURATION_BRAND_INVALID` for a brand spelled against the manifest's rule, and `W_BRAND_KIT_MISSING` at the plugin file's line for a brand no installed kit offers (a manifest's brand with no kit stays silent). `@tyto/plugin-api`'s `parsePluginFile` keeps `brand` with its range. **The isolation protocol is 11**, because a kit with colours crosses in the strict template-call and `brand-kit` schemas: a plugin process on 10 is refused at `hello`, and this release is the breaking minor ADR 0149 point 4 requires. After it is published, the contract-update workflow (ADR 0154) opens the pull request that moves `tyto-template-tabela`, `tyto-template-concursos-abertos` and the plugin repositories onto it. `@tyto/house-style` adds `accentOf(kit, fallback)`, and the house's compositions (`simuladosDaSemana`, `oneImageTable`, `productBanner`) draw the kit's accent over their own; the built-in templates, azul's `agenda-semana` and `aprovados` included, do the same, with today's colour as the fallback, so every render without a kit is byte-identical. `tyto render` passes the installed kits' brands, so the CLI reports `W_BRAND_KIT_MISSING`; the desktop already draws a configuration's kit, and reports the warning in a later change. The manual's Plugins page describes it in both editions.

### Patch Changes

- Updated dependencies [c590e01]
- Updated dependencies [e7588e9]
- Updated dependencies [4388575]
- Updated dependencies [e2b72a7]
  - @tyto/core@0.32.0
  - @tyto/recipe@0.1.3

## 0.8.0

### Minor Changes

- a5912e7: TYTO-439: plugin files resolve configurations and aliases (ADR 0151, ADR 0153). A configuration in `~/.tyto/plugin-files/*.yaml` or a trusted workspace's `.tyto/plugin-files/*.yaml` is reached by its alias — `<template>-<configuration>` when the file writes none — and the entry's `default` by the template's own name; every other configuration starts from the `default`. `tyto render` and `tyto watch` render an alias as its template with that configuration's values, the template's defaults under them and a caller's over them. A fetched pack offers only the templates its files name. `@tyto/core` adds `resolveTemplateConfigurations`, the `TemplateConfigurations` a `resolve` and a job look a name up in first, `ResolvedBrief.configuration` and `values`, `TemplateRoot` (`loadTemplateRegistry` takes a root that offers only some names) and `E_TEMPLATE_ALIAS_TAKEN`; each value is checked once, in the file that wrote it. `@tyto/plugin-api` keeps a range per configuration value, adds `configuredTemplates`, and carries `values` in a template call: **the isolation protocol is 10**, so a plugin process on 9 is refused at `hello`, and a manifest whose `engine` asks for `^0.7` is refused by this release's engine check until its range moves. `@tyto/io` adds `pluginFileImages`, which reads an image path relative to its file and keeps it inside the workspace or `TYTO_HOME`, `SyncedFolder.files` and `InstalledPacks.owners`. `@tyto/pipeline`'s `JobPorts` takes `configurations`.

### Patch Changes

- Updated dependencies [a5912e7]
  - @tyto/core@0.31.0
  - @tyto/recipe@0.1.2

## 0.7.0

### Minor Changes

- 7115286: TYTO-432: the CLI fetches what the plugin files name (ADR 0151). `tyto plugin sync` reads `~/.tyto/plugin-files/*.yaml` and a trusted workspace's `.tyto/plugin-files/*.yaml`, fetches each source with the person's own `git` into `~/.tyto/cache/plugin-files/`, and pins the commit in `plugin-files.lock.json`; `--update` moves a branch, and nothing else does. `tyto render` runs the same sync without moving anything, so it reaches the network only for a copy that is missing, and loads each copy as an installed plugin. A source that cannot be reached loads the copy fetched before and says so. `tyto plugin clean` deletes the copies no lock names. `@tyto/plugin-api` gains the plugin-file parser and the lock's schema, `@tyto/io` the fetch, cache and lock adapters, and `@tyto/core` the `*_PLUGIN_FILE_*` diagnostic codes.

### Patch Changes

- Updated dependencies [7115286]
- Updated dependencies [46a0b89]
  - @tyto/core@0.30.0
  - @tyto/recipe@0.1.1

## 0.6.0

### Minor Changes

- a558c12: A source's `page` request carries `refresh: true` on a run without cache, so the source skips its private cache and fetches; an ordinary run carries no key. The isolation protocol moves to 9, so a plugin process on 8 is refused at `hello`. The desktop's recipe notebook hands the flag on when a run is asked to start fresh.

## 0.5.0

### Minor Changes

- d4a6939: TYTO-206 (ADR 0073): `settings.json` becomes a JSON-with-comments file the person owns. `plugin-api` gains the `configuration` extension point (`registerConfiguration`, `registry.configurations()`, `InProcessHost.configure`, `resolveSettings`), and the desktop app's four settings are declared through it by a built-in `desktop` plugin, under their existing names. Reading is tolerant one key at a time; a bad value costs that key alone and is a diagnostic with a range (`E_SETTINGS_SYNTAX`, `W_SETTING_UNKNOWN`, `W_SETTING_UNPREFIXED`, `W_SETTING_INVALID`, new in `core`). The app's screens edit the file in place, keeping comments and writing only keys that differ from their defaults, and never write a file that does not parse. The previous-version import accepts a commented `settings.json`.
- 7342c02: TYTO-207 (ADR 0074): every key the window answers now comes from one keybinding table. `@tyto/editor` gains a pure resolver (`parseKey`, `resolveKeybindings`, `keymapSetFor`, `windowBindingsOf`, `shownBindingsOf`) over six closed contexts, `vimMode` and `createEditor` take their vim set as an option, and `setKeymaps` swaps both modes' bindings in place. `plugin-api`'s `editor.keymap` gains an optional `when` and is consumed by the desktop for the first time. `core` gains six codes (`E_KEYBINDINGS_SYNTAX`, `W_KEYBINDING_UNKNOWN_COMMAND`, `W_KEYBINDING_INVALID_KEY`, `W_KEYBINDING_UNKNOWN_CONTEXT`, `W_KEYBINDING_DUPLICATE`, `W_KEYBINDING_LOCKED`). The desktop's `Mod-K` listener becomes a window dispatcher for global keys, registered once. No default key changes.
- 15997e9: TYTO-208 (ADR 0077): a twelfth extension point, `theme` — `{ id, label, kind, path }`, a data-only JSON colour theme inside the plugin's folder. `registerTheme` and `registry.themes()`; an isolated plugin may contribute one. `isThemeColor` (the colour grammar that also refuses CSS injection), `isThemePath` and `resolveThemeColors`, which fills every token a theme leaves out from the base theme of its kind.
- 3921252: TYTO-254 (ADR 0145): an installed plugin can declare a setting. `registerConfiguration` takes a `form` instead of a `schema` — a scalar of one type with JSON Schema's bounds, an enum, a `tyto-pattern/1` pattern, `format: 'uri'`, or a list of one scalar; no object, no secret — which the host converts with `settingSchemaOf` and validates like any setting, with the same ranged `W_SETTING_INVALID`. The `configuration` point crosses the isolation boundary as data; an isolated plugin that passes a Zod `schema` is refused by name and told to use `form`. The isolation protocol is 7: the host sends a plugin its settings in a `configure` message whenever its host is configured, `InProcessHost.configure` emits a new `configured` host event, and `host.config` in the plugin's process answers the newest. The CLI never reads the window's `settings.json`: an installed plugin's settings take their defaults there.
- cbbf6df: TYTO-272: the `members` rule of an object setting takes `schemaByName`, a schema per member name used instead of `schema` for that member, so one object can hold members with different bounds — a size per area where each area has its own largest size. A member its own schema refuses is still `W_SETTING_INVALID` at that value, and the others apply.
- 53e01c3: TYTO-280: a plugin can supply images and fonts (ADR 0117). `@tyto/plugin-api` has two new extension points, `asset-source` (URI schemes such as `drive:`) and `font-source` (families), each with a `fetch` an installed plugin answers from its own process; the call carries the plugin's own section of the project file, absent when the folder withheld it. `@tyto/io`'s `sourceCache` asks them once and keeps the answer in `TYTO_HOME/cache/sources/<plugin>/`, named by a hash, so the next render asks nothing; a restricted folder reads the cache and fetches nothing. `@tyto/core`'s `AssetResolver` gains an optional `explain`, and a source's failure is `E_ASSET_SOURCE_FAILED` or `W_FONT_SOURCE_FAILED`. `@tyto/fonts`' library gains `refresh()`, and `@tyto/pipeline`'s `loadResources` may ask for one more compile once a fetched face arrives.
- fe85505: A list setting can be checked one entry at a time (TYTO-301, ADR 0091). A `configuration`
  contribution may declare `entries: { schema, unique }`; then an entry the schema refuses, or one
  that repeats an earlier entry when `unique` is set, is left out and reported as the new warning
  `W_SETTING_ENTRY_INVALID` at that entry, and the rest of the list still applies. `SettingEntry`
  gains `entryRanges`, so a reader can say where each entry of a list was written. Both are
  optional: every existing setting and reader behaves as before.
- 5a0c7c5: An object setting can be checked one member at a time (TYTO-301, ADR 0091). A `configuration`
  contribution may declare `members: { key, schema }`; then a member whose name `key` refuses is
  `W_SETTING_ENTRY_INVALID` at the name, one whose value `schema` refuses is `W_SETTING_INVALID` at
  the value under the dotted key, either is left out, and the rest still apply. `SettingEntry` gains
  `memberRanges`. Both are optional. `@tyto/core` adds the warning `W_SETTING_LOW_CONTRAST`, for a
  colour setting that applies although the text it leaves reads under 4.5:1.
- bf3fd0e: TYTO-304: a setting may say what each of its values does. `ConfigurationContribution` gains an
  optional `options: { value, description }[]`, and `entries` and `members` gain one each; they
  are help for the settings tab and never a rule, and an option the setting's own schema refuses
  makes the declaration throw. `outlineOf(declared)` reads every declared schema once with Zod's
  `z.toJSONSchema` and answers plain data — description, type in words, default as JSON and the
  accepted values — which is what the desktop sends to its settings tab (ADR 0092).
- 58f54d6: TYTO-370 (ADR 0134): an installed plugin can store and forget its own secrets. `host.credentials` is now a function with two methods: `host.credentials(key)` reads as before, `host.credentials.set(key, value)` stores, and `host.credentials.delete(key)` forgets and answers whether there was a value. Both need the same `credentials:<key>` permission, so an undeclared key is `E_PERMISSION`, in process and across the isolation boundary. A value is a non-empty string of at most 16 KiB in UTF-8 (`CREDENTIAL_VALUE_LIMIT_BYTES`); over it is the new `E_CREDENTIAL_TOO_LARGE` from `@tyto/core`. `HostCapabilities` gains optional `storeCredential` and `deleteCredential`; a host without them answers the new `E_CREDENTIAL_READ_ONLY`. The isolation protocol is 5. The desktop stores in the keychain, under the `plugin:<name>:<key>` account it already reads, lets a plugin's panel store and forget its own declared keys, and holds the plugins screen to the same 16 KiB. `tyto` stays read-only: a plugin's `set` or `delete` there is `E_CREDENTIAL_READ_ONLY`, naming the environment variable to set instead.
- 7a5f578: TYTO-371 (ADR 0138): a plugin gets a private cache and the open workspace's files through the host. `PluginHost` gains `host.cache` — `get(key)` answers `{ bytes, storedAt }` or `undefined`, `put(key, bytes | string)` answers `{ storedAt }`, `delete(key)` whether there was an entry, `list(prefix)` `{ key, storedAt, size }[]` — which needs no permission, and `host.workspace` — `read(path)` and `write(path, bytes | string)`, which resolves to `null` — behind the new `workspace:read` and `workspace:write` permissions. `HostCapabilities` gains six optional ports (`cacheGet`, `cachePut`, `cacheDelete`, `cacheList`, `workspaceRead`, `workspaceWrite`) and an optional `hostName`; `checkedCapabilities` refuses an undeclared access, a cache key that is empty or over 1 KiB (`PLUGIN_CACHE_KEY_LIMIT_BYTES`), an entry or file over 32 MiB (`PLUGIN_FILE_LIMIT_BYTES`), a path that leaves the folder lexically and a write into `.tyto/`. `@tyto/core` adds `E_PLUGIN_CACHE`, `E_WORKSPACE_FILE` and `E_WORKSPACE_FILE_RESTRICTED`. The isolation protocol is 6. No host implements the ports yet; until one does, both answer a refusal naming the host.
- a2b7fbd: TYTO-376 (ADR 0135), second half: a plugin can contribute recipe actions and sinks. A `recipe-verb` of kind `action` or `sink` is accepted now; it declares `writes`, the kinds of write its plans may hold, a subset of a new top-level `writes` in `tyto-plugin.json`, and is refused at load otherwise (a source or a transform declaring `writes` is refused too). Its `plan(request)` answers a `Plan` — `{ target, operations: [{ write, rowKey?, description }], count }`, new in `@tyto/recipe` with `checkPlan` and `PLAN_LIMITS` — and **nothing is written**: the plan rides the cell's result (`Cell.plan`, `VerbOutput.plan`), and the table passes through to the next cell. The host refuses a plan holding a write the verb did not declare, a `count` that is not the number of operations, a `rowKey` the table does not hold, or more than 10,000 operations, with the new `E_RECIPE_PLAN` from `@tyto/core`, placed at the verb. `tyto` loads an installed plugin that contributes them.
- 532221f: TYTO-376 (ADR 0135), first half: a plugin can contribute recipe verbs and derivations. `@tyto/plugin-api` has two new extension points, `recipe-verb` (a paged `source` or a `transform`, with its arguments declared as a small closed schema) and `recipe-derivation` (for `derive`), both named `<namespace>.<name>` in the one `namespace` a manifest now declares and owns alone; a second plugin claiming a loaded plugin's namespace is refused with `E_PLUGIN_NAMESPACE_TAKEN`, and an `action` or `sink` verb is refused until the second half. They cross to an installed plugin's process, and `recipeRegistriesOf(registry)` hands the recipe runner its verb and derivation registries. `@tyto/recipe` gains `checkTable`, `readArguments` and `pagedSource`, which loops a source page by page under provisional ceilings (8 MiB and 5,000 rows per page, 100,000 rows, 1,000 pages) and refuses a repeated cursor or a truncated page rather than answer a partial table; a plugin's derivation may be namespaced. `@tyto/core` gains `E_PLUGIN_NAMESPACE_TAKEN`, `E_RECIPE_TABLE`, `E_RECIPE_SOURCE` and `E_RECIPE_VERB`. `tyto` loads an installed plugin that contributes them.
- cfa70ff: TYTO-395 (ADR 0137): a recipe verb can read configuration from a JSON file beside the recipe, written `@./vocab.json#/kinds` (a JSON Pointer into the file) or `@./vocab.json` for the whole document. `@tyto/recipe` gains the optional `resolveData` port in `RunOptions` and `VerbContext` (passed on by `run`) and `readDataArgument`, which parses the reference, walks the pointer and checks the slice with the verb's Zod schema, reporting every refusal at the argument. `@tyto/io` gains `workspaceDataResolver`, which reads JSON with comments relative to the recipe's folder, confined to the workspace lexically and after `realpath`, refuses every file in a restricted workspace and caps a file at 1 MiB, and `readJsoncValue`. `@tyto/plugin-api` re-exports the `DataResolver` type. `@tyto/core` gains `E_RECIPE_DATA`, `E_RECIPE_DATA_RESTRICTED`, `E_RECIPE_DATA_SYNTAX` and `E_RECIPE_DATA_SHAPE`.
- e4ce1e8: TYTO-401 (ADR 0140): a recipe remembers applied rows between runs. `RunOptions` and `VerbContext` take an optional `state`, the `RecipeState` port (`read(store, keys)` and `write(store, puts, deletes)`), which `run` hands to the recipe it includes and `@tyto/plugin-api` names. `last <store> [by=<column>] [columns=a,b] [prefix=last_]` adds `last_<column>` for each stored column and `last_stored_at`, null for a row with no entry. `remember <store> columns=a,b [by=<column>] [when=…] [forget-when=…]` writes nothing during the run: its requests ride `RecipeRun.remembers`, and `stateToCommit(remembers, outcome)` returns what the host stores after an apply, dropping every row with an operation that did not apply and committing nothing for a preview. Both verbs fail with `E_RECIPE_STATE`, a new code in `@tyto/core`, where the host keeps no state.
- 4186112: TYTO-417 (ADR 0141): a plugin contributes vim mappings through a new `editor.vim` point, the seventeenth. `registerVim({ id, title?, mappings, ex? })` registers data only: each mapping binds `keys`, in an optional vim `context`, to an `operation` named by `@tyto/editor`, with optional `args`; each ex command runs a command id. It crosses an isolated plugin's boundary as data, and `registry.vim()` lists it. In `@tyto/editor`, `defineVimOperation(name, { kind: 'action' | 'operator', run })` names an operation and `setVimContributions(contributions, enabledIds)` maps the enabled contributions into the engine and unmaps the rest, per window and idempotently, so a switched-off key does what vim does by default again. A contribution that cannot be applied is left out whole with `E_VIM_CONTRIBUTION`, a new code in `@tyto/core`.
- 885d0f5: TYTO-423 (ADR 0144): a recipe brings back the rows it remembered. `RecipeState`, which `@tyto/plugin-api` names, requires `entries(store)`: every entry a store holds, empty for a store never written and `E_RECIPE_STATE` for one that cannot be read. `recipeStateStore` implements it. `recall <store> [by=<column>] [mark=<column>]` appends one row per stored key the table lacks, after the table's rows and sorted by key, with the key (and the `by=` column) set and every other column null; `mark=` adds a boolean column true on the recalled rows. A recalled key that is already another row's key under `by=` is refused, and a host without state fails as `last` does. An expiry is a recipe pattern (stamp, `age`, `rules`, `remember … forget-when=`), documented in the ADR.
- ffd4770: TYTO-428: every recipe verb call — `page`, `transform` and `plan` — carries `section`, the verb's own plugin's section of the folder's `.tyto/project.json`, absent when the folder has none or is restricted (ADR 0147). `recipeRegistriesOf(contributions, { sectionOf, limits, planLimits })` asks `sectionOf(plugin)` on every call and hands a verb only its own plugin's section; it takes an options object where it took two positional limits. `PluginRegistry.ownedRecipeVerbs()` lists each verb with its plugin. The isolation protocol is 8: a plugin process on 7 is refused at `hello`.
- 431bf23: TYTO-445: `@tyto/plugin-api/testing` runs a plugin the way the app runs it, inside a test. `testPlugin({ manifest, load })` checks the manifest's text as install does, activates the built entry over the real isolation protocol and `tryActivate`, resolves the settings it is handed, and answers either the diagnostics the app would refuse it with or a harness that runs recipes over its verbs with a fixed clock, its project section and in-memory secrets. It reads no folder and does not exercise the sandbox (ADR 0150).

### Patch Changes

- bdab5da: TYTO-396 (ADR 0136): three generic recipe verbs that carry a company's rules as configuration. `rules into=<columns> using=<table>` classifies each row by an ordered table of `{ when, set }` entries, where `when` is a `where` expression (`matches` included), the first entry a row satisfies decides, and an empty `when` is the default; the table is a data reference or JSON written inline at the end of the line. `compose <column>="<template>" [skip-empty] [required]` fills a text column from `{column|filter}` placeholders with the filters `slug`, `trim`, `upper` and `lower`. `collect <column> from=a,b,c [skip-empty]` gathers columns into a list column, the keys a row offers `join`. `@tyto/recipe` exports `parseTemplate`, `bindTemplate` and `TEMPLATE_FILTERS`; `@tyto/core` gains `E_RECIPE_RULES` and `E_RECIPE_TEMPLATE`.
- eb0694a: TYTO-397 (ADR 0136): three more generic recipe verbs driven by configuration. `extract <column> pattern=<pattern> [into=<columns>|into=<prefix>*]` writes one text column per named group of a `tyto-pattern/1` pattern, `null` where it does not match. `rewrite <column> into=<column> using=<list>` applies an ordered list of `{ pattern, replace }` steps, each to every match, where `replace` puts a named group back with `$<name>` and writes a dollar as `$$`. `urls into=<column> from=a,b host=<hosts> [first]` gathers the links on the hosts named from text and list cells, the first column before the second, cut at a Markdown or HTML wrapper and without a trailing full stop or comma, each once; `first` writes a link column with the first one. Patterns, lists and hosts may be data references. `@tyto/core` gains `E_RECIPE_REWRITE`.
- 7704e9c: TYTO-398 (ADR 0136): the generic recipe verb `nearest <prefix> within=<column> among="<where>" by=words(<column>) stopwords=<words> [min-length=<n>] bring=<columns>`. For each row it looks at the other rows of its group that the `among` expression keeps and chooses the only one, or the one sharing the most distinct words of the `by` column (lower case, without the stopwords and words shorter than `min-length`, two by default), the first in table order on a tie and none when no word is shared. What `bring` names is added as `<prefix>_<column>`; nothing is consumed. The stopwords are written inline or read from a data file.
- dded20c: TYTO-399 (ADR 0139): a recipe run reads time from an injected clock, and the generic verb `age`. `RunOptions` and `VerbContext` take an optional `clock` (`now()` and `offsetMinutes(at)`), the machine's clock and zone by default (`systemClock`), which `run` hands to the recipe it includes and no plugin receives. `age <column> format="dd-MM HH:mm,dd-MM" [year=infer-past] into=<column>` writes the hours since each cell's stamp, in whole minutes over 60, reading the stamp as wall-clock time in the clock's offset with the formats tried in order (tokens dd, MM, yyyy, HH, mm; one or two digits; no time is midnight). A format without yyyy needs `year=infer-past`, which takes the clock's year or the year before, whichever first reads no later than a day after now. An empty cell has no age; one no format reads has none either, counted by one `W_RECIPE_AGE_UNREAD` warning per step, a new code in `@tyto/core`.
- 320c0c7: TYTO-399 (ADR 0136): two generic recipe verbs and numeric comparison in `where`. `map <column> using=<table> [reverse] [also=<table>] into=<column>` translates a column by an object of text to text, compared without accents, case or surrounding blanks and written as the table spells it; `reverse` reads it from value to key (the first key in file order wins on a shared value), `also=` is consulted after it, and a value neither names maps to an empty cell. `path from=<column> to=<column> graph=<graph> avoid=<nodes> into=<column>` writes, as a list, the shortest walk through a graph of each node's arrows: empty when the row is already there, an empty cell when the graph does not join the two without an avoided node; a graph whose names fold to one is refused. The `where` grammar, and so `rules`, `join` and `nearest`, gains `<`, `<=`, `>` and `>=` against a number; a cell that is not a number drops the row.
- 3da246d: TYTO-418: the `editor.vim` test's example contribution maps surround's `s` in operator-pending
  mode, as the built-in does, instead of `ys` in normal mode, which the engine never reaches.
- Updated dependencies [d4a6939]
- Updated dependencies [08b936d]
- Updated dependencies [7342c02]
- Updated dependencies [15997e9]
- Updated dependencies [93fcb8b]
- Updated dependencies [ea97dc3]
- Updated dependencies [c005b91]
- Updated dependencies [2495d0d]
- Updated dependencies [6abf89f]
- Updated dependencies [53e01c3]
- Updated dependencies [ae75027]
- Updated dependencies [fe85505]
- Updated dependencies [5a0c7c5]
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
- Updated dependencies [719585d]
- Updated dependencies [5f98674]
- Updated dependencies [cfa70ff]
- Updated dependencies [bdab5da]
- Updated dependencies [eb0694a]
- Updated dependencies [7704e9c]
- Updated dependencies [dded20c]
- Updated dependencies [320c0c7]
- Updated dependencies [dd7563b]
- Updated dependencies [e4ce1e8]
- Updated dependencies [fdcfda9]
- Updated dependencies [4186112]
- Updated dependencies [885d0f5]
- Updated dependencies [3921252]
  - @tyto/core@0.29.0
  - @tyto/recipe@0.1.0

## 0.4.1

### Patch Changes

- Updated dependencies [b20fe47]
- Updated dependencies [7dad141]
- Updated dependencies [4532332]
  - @tyto/core@0.28.0

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
