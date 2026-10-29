# @tyto/recipe

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
