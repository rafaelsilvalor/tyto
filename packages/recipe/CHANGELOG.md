# @tyto/recipe

## 0.7.0

### Minor Changes

- 0c38153: TYTO-712: the recipe editor reads the word after a `|` that chains steps as a verb. It colours
  it as one and offers verbs there, splitting a line where the parser does, through
  `chainSegments`, which `@tyto/recipe` now exports.
- 85f200f: TYTO-714: `decide` with `clear=push` holds the clears of a run that look like a lost read. When
  the `local=` column is missing or empty on every row while `last` holds values, no clear is
  pushed and one `W_RECIPE_DECIDE_CLEAR_COLUMN` names the column; when a run would push more
  clears than the new `clear-limit=<n>|none` (5 when not given), none is pushed and one
  `W_RECIPE_DECIDE_CLEAR_LIMIT` gives the count. A held clear is a `hold` row whose decided value
  is the last one, so the state does not advance. The desktop's recipe form gains the
  `clear-limit` field's Portuguese help, and the user manual a section on syncing a field both
  ways.

### Patch Changes

- Updated dependencies [85f200f]
  - @tyto/core@0.46.0
  - @tyto/brief-lang@0.8.5

## 0.6.0

### Minor Changes

- d267e4a: `decide` takes `clear=push|pull`. With `clear=push`, a value cleared in the local side since the last applied run pushes the empty value to the remote side (`_pushes` true, `_push` empty), and `tie=` settles it when the remote side changed too. `pull`, the default, keeps today's rule: an empty local value never pushes. The `decide` form lists the new choice.
- b250bc7: `decide` also writes `<column>_pushes`, a boolean true exactly on push rows, so a write to the remote side can choose its rows without reading the pushed value.
- 61edee2: The recipe step forms show each verb's summary and each field's help in the window's language
  (TYTO-685). `@tyto/recipe` adds `formTexts`, `summaryKey` and `helpKey`: every generic form's
  sentence keyed by the verb's and the field's names, the English the source; the desktop
  translates them into Portuguese and keeps the English for any sentence it has no translation of.
- 0ff1b0d: A contributed recipe verb's argument may carry `description`, at most 1,000 characters
  (`ARGUMENT_DESCRIPTION_MAX_LENGTH`), and `formOfArguments` shows it as the field's help in the
  step form (TYTO-687). An isolated plugin's crosses the strict `recipe-verb` schema: isolation
  protocol 26. One over the bound is refused at load with the same `E_PLUGIN_ACTIVATE` in
  process as isolated.
- 928e28b: A recipe line may name a column it writes or picks in double quotes, with accents and blanks:
  `into="Última Sync"`, `compose "Última Sync"={due|slug}`, `select key, "Última Sync"`. Bare
  names keep their rule; the form library quotes such names and round-trips them (TYTO-674).
- 3ff3d59: A recipe's block can be dragged to another place by its grip (TYTO-676). `moveBlockTo` in
  `@tyto/recipe` moves a block before any other, or below the last, as one edit that rewrites the
  blocks passed over and never the block moved. `notebookFrames()` in `@tyto/editor` draws a grip
  on each movable frame, drags with pointer events (Escape, blur or an edit cancel it) and draws
  the drop line; the host's `move` receives the drop. In the desktop the drop is one undo.
- 672be6c: A recipe's block is a run of lines between blank lines, like a Jupyter cell, and shows its last
  step's result (TYTO-676, ADR 0196). `recipeBlocks` in `@tyto/recipe` reads blocks of several
  steps and `#` lines, the header split from a step written right under it; `RecipeBlock.step`
  becomes `steps: { first, last, lastFrom }`, and `recipeLines` lists a text's step or header
  lines. `deleteBlock` takes the blank line that set the block apart. In the desktop a block draws
  one result, its last step's, while every step still runs and marks its own problems; Run this
  block runs all its steps; the "+" writes a new block; the counter and the fold are the block's;
  Add step joins the block the cursor is in.
- 30bb335: TYTO-675 (ADR 0139 note of 2026-11-12): a recipe template writes an ISO-8601 instant as
  wall-clock time in the run's zone with the filter `local:<format>`, as in
  `compose day="{due|local:yyyy-MM-dd}"` or `{due|local:dd/MM/yyyy HH:mm}`, so a delivery at
  22:00 in São Paulo stays on its day. The format takes the tokens `age format=` reads (dd, MM,
  yyyy, HH, mm); a letter outside a token is refused with `E_RECIPE_TEMPLATE`. `RunClock` gains
  an optional IANA `timeZone`: with it the wall clock is read through `Intl.DateTimeFormat`, with
  its daylight-saving rules; without it through `offsetMinutes`. The desktop's clock names the
  zone of the `recipeTimeZone` setting. A cell that is not an instant with `Z` or an offset is
  written empty and counted by the new warning `W_RECIPE_LOCAL_UNREAD` in `@tyto/core`.
- e34def6: A recipe reads as blocks in the window (TYTO-676, ADR 0195). `@tyto/recipe` gains
  `recipeBlocks`, the text read by line as header, step and note blocks, and `moveBlock` and
  `deleteBlock`, each one edit of the text that keeps every other byte. `@tyto/editor` gains
  `notebookFrames()`, which frames each block over the one editor with the host's toolbar on its
  first line, and `cellOutputAt`. The runner takes `until`, the cell a run stops after. In the
  desktop each block but the header has a toolbar: Run this block, Move up, Move down, Delete
  block, and Hide result, which now folds a plan's lines and a run cell's included cells too.
- 399281d: A recipe can report to a person with `warn when="<where>" message="<template>"`: one `W_RECIPE_WARN` warning per row the expression keeps, in table order, naming the row's key, its message filled from the row with `compose`'s `{column|filter}` templates or read from a data file. The table passes on unchanged, so the warning outlives a later `where` that drops the row. One step lists at most 100 rows and adds one warning counting the rest. `@tyto/core` gains the `W_RECIPE_WARN` code; the `warn` form joins `GENERIC_VERB_FORMS`.
- b704587: TYTO-706: a `|` standing alone on a step line chains several steps, each read as if on its own line of the same block; `recipeSteps(text)` gives each step's place.

### Patch Changes

- 1fae4a5: TYTO-640: `fileSafeName` keeps the base letter of an accented Latin letter (`Matemática` →
  `Matematica`, `Straße` → `Strasse`), drops a trailing dot or space, and gives a Windows device
  name (`CON`, `nul.brief`, `COM1`…) a `_` on its stem. Both callers change with it: a `to-brief`
  row named `Matemática` writes `Matematica.brief`, and a format named `miniatura-vídeo` is
  delivered as `miniatura-video-01.png` (ADR 0053, note of 2026-11-12). Names that were already
  ASCII-safe are unchanged.
- Updated dependencies [46a013d]
- Updated dependencies [d700cf3]
- Updated dependencies [ef76145]
- Updated dependencies [1fae4a5]
- Updated dependencies [30bb335]
- Updated dependencies [399281d]
- Updated dependencies [ca2bc10]
  - @tyto/core@0.45.0
  - @tyto/brief-lang@0.8.4

## 0.5.0

### Minor Changes

- 9aa8b41: TYTO-402, ADR 0176: the pure functions the window authors recipes with. `recipeSkeleton` writes
  a new recipe that runs as made; `GENERIC_VERB_FORMS` gives every generic verb's fields and
  `formOfArguments` a contributed verb's; `formatStep` writes a form's values as one recipe line
  that parses and reads back through `valuesOfStep`; `referencesOf` lists the data files and
  included recipes a recipe names. `@tyto/core` gains `E_RECIPE_FORM`.
- e7c1db1: TYTO-671, ADR 0193: the window sends a recipe's `call` requests. A person stores the credential
  a `call` line names in the plugins screen's new Recipe credentials section, write-only, kept in
  the keychain under `recipe:<name>`, listed by name and forgotten from there; Apply then sends
  each planned request to a host the trusted folder's `recipes.call.hosts` allows. `recipe:` is
  reserved in `@tyto/plugin-api` (`RECIPE_CREDENTIAL_KEY_PREFIX`) like `signin-client:`: no
  plugin's `credentials:` permission or `host.credentials` call reaches it. `@tyto/recipe` exports
  `CALL_CREDENTIAL_NAME`, and its "store it first" refusal names the screen and the CLI's variable.
- fe22e84: TYTO-671, ADR 0193: `call url=<https address> token=<credential> body=<json>`, a generic action
  that plans one POST per row to a host the workspace allows and sends nothing until Apply. The
  body is JSON whose strings are `{column}` templates; the verb names the credential and never
  holds it. `CallPorts` is the port a host lends through `createVerbRegistry({ calls })`, and
  `recipeRegistriesOf` forwards its own `calls` option. `@tyto/core` gains `E_RECIPE_CALL`.
- 0ed9eba: TYTO-402, ADR 0176 decision 5: `lintVocabulary` checks a `*.vocab.json` where it is written, its
  rules, rewrites and lookups by their verbs' schemas and its filters, patterns, templates and
  replacements at the file's characters, mapped through the JSON string escapes;
  `vocabularySkeleton` writes one that lints clean. `@tyto/recipe` depends on `jsonc-parser`, the
  reader `@tyto/io` uses for data files. `@tyto/core` gains `E_VOCABULARY_SYNTAX` and
  `E_VOCABULARY_SHAPE`.

### Patch Changes

- Updated dependencies [9aa8b41]
- Updated dependencies [68a241a]
- Updated dependencies [fe22e84]
- Updated dependencies [0ed9eba]
  - @tyto/core@0.44.0
  - @tyto/brief-lang@0.8.3

## 0.4.0

### Minor Changes

- 58baf48: The recipe runner and its Apply move from the desktop's main into `@tyto/io` (`createRecipeRunner`,
  ADR 0188), unchanged, so `tyto mcp` can run a recipe through the same code. The notebook's views,
  `RECIPE_VIEWS`, move into `@tyto/recipe`. The desktop behaves as before.

### Patch Changes

- Updated dependencies [4cae56d]
- Updated dependencies [94c593c]
  - @tyto/core@0.43.1
  - @tyto/brief-lang@0.8.2

## 0.3.1

### Patch Changes

- Updated dependencies [7345ac7]
  - @tyto/core@0.43.0
  - @tyto/brief-lang@0.8.1

## 0.3.0

### Minor Changes

- 98322e5: TYTO-385: a recipe's header may say `every 30m` or `every 2h`, parsed into `RecipeAst.every` in
  minutes. Under 5 minutes, a second `every`, or one after the first step is `E_RECIPE_SYNTAX`.
  Nothing runs it on that interval yet.
- 4a91cef: A recipe's views read rows from main in pages, and `show` checks its view (TYTO-379, ADR 0171).
  `RunOptions.views` and `VerbContext.views` map a view name to the arguments it reads
  (`ViewArgumentSpec`: `column`, `columns`, `values` or `choice`); with a list, `show` refuses a
  view not in it as `E_RECIPE_VIEW` (new in core) at the view's word, and an unknown, missing or
  stray argument at its range, columns resolved through the aliases. Without a list `show` takes
  any one name, as before. Every cell carries `Cell.view`, the last `show` at or above it with its
  arguments, and `run` hands the list and the included recipe's view on. The `sort` verb's order
  is exported as `compareCells`. In the desktop, main passes the notebook's views (`table`,
  `summary`) to every run, the cell on the wire carries its view, and two channels read a cell's
  kept table: `recipe:rows` answers a page of it sorted and filtered in main over indices, never
  moving the recipe's rows, with the Summary's totals over the rows the filter keeps, and
  `recipe:copy` writes rows to the clipboard as quoted tab-separated text built from the whole
  values. A page names the run it reads and a newer one answers `stale`. The Table view follows.
- 4db076c: A recipe gains the generic sink `to-brief template=<name> into=<folder> name=<column>
slots=<slot>:<column>,…` (TYTO-380, ADR 0172): it plans one brief per row in the chosen template,
  each marked new or overwriting, and writes them on Apply through `ToBriefPorts` the host lends
  through `createVerbRegistry({ briefs })` and `recipeRegistriesOf`'s `briefs` option; a file
  changed since the plan fails that write while the others apply. `@tyto/brief-lang` gains
  `writeBrief`, which writes a brief from a template name and slot values and parses it back,
  refusing a value that holds a brace. `@tyto/core` gains `fileSafeName`, which the pipeline's
  `artifactName` now calls, and the diagnostic code `E_RECIPE_BRIEF`.
- 321e1f4: The recipe notebook draws `show board by=<column>` as a Board (TYTO-381, ADR 0177): one column per
  value of the column, grouped without case or accents, with the count main made over the rows the
  quick filter keeps, and a card per row showing `fields=` (the first three other columns when
  absent). `order=` places values first, the rest follow by first appearance and an empty value is
  a "(none)" column at the end. A column draws fifty cards, then "N more". View only. A new
  channel, `recipe:facets`, counts a column's groups in main, and `recipe:rows` gains `facet` to
  page one group's rows. In `@tyto/recipe`, a view's `values` argument reads a data file's list of
  strings (`order=@./board.json#/order`) through the host's data resolver, so `show` reads its
  arguments asynchronously.
- 3642f9a: TYTO-421: `decide` takes `tie=local|remote`, the side that wins a row both sides changed since
  the last run (`local` when not given, as before). It also writes `<column>_push`, the decided
  value on push rows only, and `<column>_overwritten`, the losing side's value where both
  changed; `<column>_overrides` is now true on such a row whichever side wins. The decided column
  may be the `local=` column itself, rewritten in place as `map` rewrites its `into=`.
  `Decision` gains `overwritten`.
- a8b91a3: TYTO-449: a recipe's `run` cell opens onto the included recipe's own cells. `@tyto/recipe` adds
  `VerbOutput.included` and `Cell.included` (the `IncludedRecipe` type), set on a `run` that
  succeeded; the desktop notebook carries them on the wire and shows them read-only, closed until
  **Show the included recipe's cells** is clicked.

### Patch Changes

- Updated dependencies [cd096ab]
- Updated dependencies [ed7a364]
- Updated dependencies [4a91cef]
- Updated dependencies [4db076c]
- Updated dependencies [c0875cc]
- Updated dependencies [64a7b70]
  - @tyto/core@0.42.0
  - @tyto/brief-lang@0.8.0

## 0.2.0

### Minor Changes

- 6b193ff: The contract an Apply runs on (ADR 0170). A planned operation may carry the plugin's own
  `payload`, at most 2,048 bytes of JSON, which `checkPlan` refuses past; a verb may declare
  `apply(plan)`; an applied operation may say `reason` and `appliedAt`; each cell holds what it
  asked `remember` to store; `stateToCommit` stamps an applied row's puts with `applied_at`, so a
  later run reads `last_applied_at`; and a recipe's header may say `apply auto`, any other word
  after `apply` being a syntax error. Core adds `E_RECIPE_APPLY`, the refusal of an Apply whose
  shown plan holds a write the verb no longer declares. Nothing applies yet: the host's Apply
  lands in the next pull requests of TYTO-378.

### Patch Changes

- Updated dependencies [6b193ff]
- Updated dependencies [fb529a1]
  - @tyto/core@0.41.0

## 0.1.12

### Patch Changes

- Updated dependencies [6f4c86e]
- Updated dependencies [f658466]
- Updated dependencies [4a7c29d]
- Updated dependencies [8d081ec]
  - @tyto/core@0.40.0

## 0.1.11

### Patch Changes

- Updated dependencies [d2ca2f1]
  - @tyto/core@0.39.0

## 0.1.10

### Patch Changes

- Updated dependencies [b5d2c00]
  - @tyto/core@0.38.0

## 0.1.9

### Patch Changes

- Updated dependencies [6d363a3]
- Updated dependencies [7c650a4]
- Updated dependencies [d1cd8ba]
  - @tyto/core@0.37.0

## 0.1.8

### Patch Changes

- Updated dependencies [e94aa55]
  - @tyto/core@0.36.1

## 0.1.7

### Patch Changes

- 9021b50: Rename shadowing local bindings without changing behavior and enforce the no-shadow lint rule.
- Updated dependencies [9021b50]
- Updated dependencies [93fb9c9]
- Updated dependencies [147eafa]
- Updated dependencies [05c9f83]
  - @tyto/core@0.36.0

## 0.1.6

### Patch Changes

- Updated dependencies [fc3bee5]
- Updated dependencies [6881557]
- Updated dependencies [4168183]
  - @tyto/core@0.35.0

## 0.1.5

### Patch Changes

- Updated dependencies [503f924]
- Updated dependencies [6d431f6]
- Updated dependencies [eca9871]
- Updated dependencies [b7c5136]
- Updated dependencies [b40dea8]
- Updated dependencies [0164874]
- Updated dependencies [cd14464]
  - @tyto/core@0.34.0

## 0.1.4

### Patch Changes

- Updated dependencies [f612e26]
- Updated dependencies [096f80e]
  - @tyto/core@0.33.0

## 0.1.3

### Patch Changes

- Updated dependencies [c590e01]
- Updated dependencies [e7588e9]
- Updated dependencies [4388575]
- Updated dependencies [e2b72a7]
  - @tyto/core@0.32.0

## 0.1.2

### Patch Changes

- Updated dependencies [a5912e7]
  - @tyto/core@0.31.0

## 0.1.1

### Patch Changes

- Updated dependencies [7115286]
- Updated dependencies [46a0b89]
  - @tyto/core@0.30.0

## 0.1.0

### Minor Changes

- 3355317: TYTO-375 (ADR 0133), second half: the recipe package gains its last three generic verbs. `join <prefix> left="…" right="…" on=<column> [bring=…]` pairs rows of the one table on a key column, which may hold a list on either side; the right side is consumed into `<prefix>_<column>` columns, and `<prefix>_match` says `paired`, `ambiguous (N candidates)`, `no key` or `no pair`, an ambiguous key never pairing. `derive <name>…` runs registered derivations, awaiting each, after checking the columns it requires and before trusting the columns it promised. `run <recipe> name=value…` includes another recipe at its line through the `resolveRecipe` port, refusing a cycle. A verb's output now carries `keeps` (a list) instead of `keep`, and its context carries the verb registry and the recipes running. `core` gains `E_RECIPE_DERIVATION`, `E_RECIPE_RUN` and `W_RECIPE_JOIN_AMBIGUOUS`.
- eb55249: TYTO-375 (ADR 0128), first half: a new pure package, `@tyto/recipe`, holds the table that passes between recipe verbs (`Table`, `Column`, `Row`, `Provenance`), the `*.recipe` parser (`parseRecipe`: header, `|` description, `param` lines, one verb per line, every diagnostic with a range), the `where` filter grammar ported from Buraqueira's `flow.py` (`parseWhere`: `=`, `!=`, `~`, `!~`, `in`, `not in`, `is [not] empty`, `AND` only, values compared without case or accents), and the runner (`runRecipe`, asynchronous, one cell per line). The generic verbs `where`, `select`, `sort`, `show` and `keep` are registered by `createVerbRegistry`, which accepts only namespaced verbs from plugins; `createDerivationRegistry` starts empty. Aliases are input-only. `join`, `derive` and `run` follow in the second half. `core` gains the `E_RECIPE_*` codes and `W_RECIPE_WHERE_EMPTY`.
- a2b7fbd: TYTO-376 (ADR 0135), second half: a plugin can contribute recipe actions and sinks. A `recipe-verb` of kind `action` or `sink` is accepted now; it declares `writes`, the kinds of write its plans may hold, a subset of a new top-level `writes` in `tyto-plugin.json`, and is refused at load otherwise (a source or a transform declaring `writes` is refused too). Its `plan(request)` answers a `Plan` — `{ target, operations: [{ write, rowKey?, description }], count }`, new in `@tyto/recipe` with `checkPlan` and `PLAN_LIMITS` — and **nothing is written**: the plan rides the cell's result (`Cell.plan`, `VerbOutput.plan`), and the table passes through to the next cell. The host refuses a plan holding a write the verb did not declare, a `count` that is not the number of operations, a `rowKey` the table does not hold, or more than 10,000 operations, with the new `E_RECIPE_PLAN` from `@tyto/core`, placed at the verb. `tyto` loads an installed plugin that contributes them.
- 532221f: TYTO-376 (ADR 0135), first half: a plugin can contribute recipe verbs and derivations. `@tyto/plugin-api` has two new extension points, `recipe-verb` (a paged `source` or a `transform`, with its arguments declared as a small closed schema) and `recipe-derivation` (for `derive`), both named `<namespace>.<name>` in the one `namespace` a manifest now declares and owns alone; a second plugin claiming a loaded plugin's namespace is refused with `E_PLUGIN_NAMESPACE_TAKEN`, and an `action` or `sink` verb is refused until the second half. They cross to an installed plugin's process, and `recipeRegistriesOf(registry)` hands the recipe runner its verb and derivation registries. `@tyto/recipe` gains `checkTable`, `readArguments` and `pagedSource`, which loops a source page by page under provisional ceilings (8 MiB and 5,000 rows per page, 100,000 rows, 1,000 pages) and refuses a repeated cursor or a truncated page rather than answer a partial table; a plugin's derivation may be namespaced. `@tyto/core` gains `E_PLUGIN_NAMESPACE_TAKEN`, `E_RECIPE_TABLE`, `E_RECIPE_SOURCE` and `E_RECIPE_VERB`. `tyto` loads an installed plugin that contributes them.
- 719585d: TYTO-382: `group by=` collapses a table into one row per group, `count` writes how many items a list column holds, and `summarize` totals each number column of what a `show summary` shows.
- 5f98674: TYTO-394 (ADR 0136): `where` can match a cell against a pattern, with `matches "<pattern>"` and `not matches "<pattern>"`. Patterns are `tyto-pattern/1`: JavaScript syntax with the flags `iu`, where `\b`, `\w` and `\d` (and `\B`, `\W`, `\D`) know every Unicode letter and digit. A guard refuses backreferences, lookaround and nested quantifiers at compile time, a pattern holds at most 512 characters, and a cell is tested on its first 4,096. `@tyto/recipe` exports `compilePattern` for the verbs that will match text next; `@tyto/core` gains `E_RECIPE_PATTERN` and `E_RECIPE_PATTERN_UNSAFE`. A recipe's `{param}` no longer catches the braces of `\p{…}`, `\P{…}` or `\u{…}`.
- cfa70ff: TYTO-395 (ADR 0137): a recipe verb can read configuration from a JSON file beside the recipe, written `@./vocab.json#/kinds` (a JSON Pointer into the file) or `@./vocab.json` for the whole document. `@tyto/recipe` gains the optional `resolveData` port in `RunOptions` and `VerbContext` (passed on by `run`) and `readDataArgument`, which parses the reference, walks the pointer and checks the slice with the verb's Zod schema, reporting every refusal at the argument. `@tyto/io` gains `workspaceDataResolver`, which reads JSON with comments relative to the recipe's folder, confined to the workspace lexically and after `realpath`, refuses every file in a restricted workspace and caps a file at 1 MiB, and `readJsoncValue`. `@tyto/plugin-api` re-exports the `DataResolver` type. `@tyto/core` gains `E_RECIPE_DATA`, `E_RECIPE_DATA_RESTRICTED`, `E_RECIPE_DATA_SYNTAX` and `E_RECIPE_DATA_SHAPE`.
- bdab5da: TYTO-396 (ADR 0136): three generic recipe verbs that carry a company's rules as configuration. `rules into=<columns> using=<table>` classifies each row by an ordered table of `{ when, set }` entries, where `when` is a `where` expression (`matches` included), the first entry a row satisfies decides, and an empty `when` is the default; the table is a data reference or JSON written inline at the end of the line. `compose <column>="<template>" [skip-empty] [required]` fills a text column from `{column|filter}` placeholders with the filters `slug`, `trim`, `upper` and `lower`. `collect <column> from=a,b,c [skip-empty]` gathers columns into a list column, the keys a row offers `join`. `@tyto/recipe` exports `parseTemplate`, `bindTemplate` and `TEMPLATE_FILTERS`; `@tyto/core` gains `E_RECIPE_RULES` and `E_RECIPE_TEMPLATE`.
- eb0694a: TYTO-397 (ADR 0136): three more generic recipe verbs driven by configuration. `extract <column> pattern=<pattern> [into=<columns>|into=<prefix>*]` writes one text column per named group of a `tyto-pattern/1` pattern, `null` where it does not match. `rewrite <column> into=<column> using=<list>` applies an ordered list of `{ pattern, replace }` steps, each to every match, where `replace` puts a named group back with `$<name>` and writes a dollar as `$$`. `urls into=<column> from=a,b host=<hosts> [first]` gathers the links on the hosts named from text and list cells, the first column before the second, cut at a Markdown or HTML wrapper and without a trailing full stop or comma, each once; `first` writes a link column with the first one. Patterns, lists and hosts may be data references. `@tyto/core` gains `E_RECIPE_REWRITE`.
- 7704e9c: TYTO-398 (ADR 0136): the generic recipe verb `nearest <prefix> within=<column> among="<where>" by=words(<column>) stopwords=<words> [min-length=<n>] bring=<columns>`. For each row it looks at the other rows of its group that the `among` expression keeps and chooses the only one, or the one sharing the most distinct words of the `by` column (lower case, without the stopwords and words shorter than `min-length`, two by default), the first in table order on a tie and none when no word is shared. What `bring` names is added as `<prefix>_<column>`; nothing is consumed. The stopwords are written inline or read from a data file.
- dded20c: TYTO-399 (ADR 0139): a recipe run reads time from an injected clock, and the generic verb `age`. `RunOptions` and `VerbContext` take an optional `clock` (`now()` and `offsetMinutes(at)`), the machine's clock and zone by default (`systemClock`), which `run` hands to the recipe it includes and no plugin receives. `age <column> format="dd-MM HH:mm,dd-MM" [year=infer-past] into=<column>` writes the hours since each cell's stamp, in whole minutes over 60, reading the stamp as wall-clock time in the clock's offset with the formats tried in order (tokens dd, MM, yyyy, HH, mm; one or two digits; no time is midnight). A format without yyyy needs `year=infer-past`, which takes the clock's year or the year before, whichever first reads no later than a day after now. An empty cell has no age; one no format reads has none either, counted by one `W_RECIPE_AGE_UNREAD` warning per step, a new code in `@tyto/core`.
- 320c0c7: TYTO-399 (ADR 0136): two generic recipe verbs and numeric comparison in `where`. `map <column> using=<table> [reverse] [also=<table>] into=<column>` translates a column by an object of text to text, compared without accents, case or surrounding blanks and written as the table spells it; `reverse` reads it from value to key (the first key in file order wins on a shared value), `also=` is consulted after it, and a value neither names maps to an empty cell. `path from=<column> to=<column> graph=<graph> avoid=<nodes> into=<column>` writes, as a list, the shortest walk through a graph of each node's arrows: empty when the row is already there, an empty cell when the graph does not join the two without an avoided node; a graph whose names fold to one is refused. The `where` grammar, and so `rules`, `join` and `nearest`, gains `<`, `<=`, `>` and `>=` against a number; a cell that is not a number drops the row.
- dd7563b: TYTO-401 (ADR 0140): `decide <column> local=<column> remote=<column> last=<column> [values=a,b|@ref] [first-run-wins=<value>] [hold-when-empty=<column>]` decides, row by row, which side of a sync wins, ported from Buraqueira's `decidir`: whichever side changed since the last applied run wins, the local one when both did; with no last value only `first-run-wins` beats the remote side, and without it the remote side fills. Values compare without accents, case or surrounding blanks; an empty remote value is intermediate; a local value `values=` does not list is replaced. It adds `<column>`, `<column>_action` (push, pull, same or hold), `<column>_overrides` and `<column>_reason`; a push where `hold-when-empty=` is empty becomes `hold`. `decideValue` exports the rule itself.
- e4ce1e8: TYTO-401 (ADR 0140): a recipe remembers applied rows between runs. `RunOptions` and `VerbContext` take an optional `state`, the `RecipeState` port (`read(store, keys)` and `write(store, puts, deletes)`), which `run` hands to the recipe it includes and `@tyto/plugin-api` names. `last <store> [by=<column>] [columns=a,b] [prefix=last_]` adds `last_<column>` for each stored column and `last_stored_at`, null for a row with no entry. `remember <store> columns=a,b [by=<column>] [when=…] [forget-when=…]` writes nothing during the run: its requests ride `RecipeRun.remembers`, and `stateToCommit(remembers, outcome)` returns what the host stores after an apply, dropping every row with an operation that did not apply and committing nothing for a preview. Both verbs fail with `E_RECIPE_STATE`, a new code in `@tyto/core`, where the host keeps no state.
- fdcfda9: TYTO-401 (ADR 0140): `rollup <column> parent=<column> [when="<where>"]` counts, on each row that is another row's parent, its children that `when` keeps, and leaves every other row empty; children whose parent is not in the table count nowhere and raise `W_RECIPE_ROLLUP_ORPHANS`, a new warning in `@tyto/core`. `stamp <column> when="<where>" format="dd-MM HH:mm" [clear-when="<where>"]` writes the run clock's wall-clock time into the empty cells of the rows `when` keeps, never overwrites a cell that holds something, and empties the cell on the rows `clear-when` keeps. `age` takes `month-into=<column>`, the month the stamp files under as `yyyy-MM`. A parent's decision is a few rollups and a `rules` table, and the 72-hour hold is `age` and `where`.
- 885d0f5: TYTO-423 (ADR 0144): a recipe brings back the rows it remembered. `RecipeState`, which `@tyto/plugin-api` names, requires `entries(store)`: every entry a store holds, empty for a store never written and `E_RECIPE_STATE` for one that cannot be read. `recipeStateStore` implements it. `recall <store> [by=<column>] [mark=<column>]` appends one row per stored key the table lacks, after the table's rows and sorted by key, with the key (and the `by=` column) set and every other column null; `mark=` adds a boolean column true on the recalled rows. A recalled key that is already another row's key under `by=` is refused, and a host without state fails as `last` does. An expiry is a recipe pattern (stamp, `age`, `rules`, `remember … forget-when=`), documented in the ADR.

### Patch Changes

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
- Updated dependencies [5f98674]
- Updated dependencies [cfa70ff]
- Updated dependencies [bdab5da]
- Updated dependencies [eb0694a]
- Updated dependencies [dded20c]
- Updated dependencies [e4ce1e8]
- Updated dependencies [fdcfda9]
- Updated dependencies [4186112]
- Updated dependencies [3921252]
  - @tyto/core@0.29.0
