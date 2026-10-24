# 0135 — A plugin contributes recipe verbs in a namespace it owns

Status: accepted · 2026-10-24 · TYTO-376 · builds on ADR 0128, ADR 0129, ADR 0133, ADR 0127,
ADR 0041, ADR 0042, ADR 0043 and ADR 0117.

## Context

ADR 0128 promised that plugins contribute namespaced verbs of four kinds (source, transform,
action, sink) and derivations for `derive`, and that a source pages because every call into a
plugin has a 30 s deadline (ADR 0042). ADR 0129 promised that an action or a sink plans before
it writes, and that a connector declares the kinds of write it may make. `plugin-api` had no
point for any of it: its `source` and `sink` points are for briefs, and are refused for an
installed plugin.

The Jira and Google connectors and the private rules plugin (TYTO-391) live in their own
repositories (ADR 0127). Each needs one door that works the same in process and behind the
message boundary (ADR 0041), and a shared recipe must mean the same on every machine whatever
those plugins are.

## Decision

1. **Two extension points.** `recipe-verb` is `{ id: '<namespace>.<verb>', kind, arguments,
writes? }` with one callable per kind; `recipe-derivation` is `{ id: '<namespace>.<name>',
requires, produces }` and its `derive(table)`. Both work for built-in and installed plugins
   alike; an installed plugin's callables cross as handles, like a directive's `transform`.
2. **A plugin declares one `namespace` in its manifest, and owns it.** Every verb and
   derivation it registers is named `<namespace>.<name>`; registering another name refuses the
   plugin. A second plugin declaring a namespace a loaded plugin already owns is refused at
   load, whole, with `E_PLUGIN_NAMESPACE_TAKEN`: a namespace is one plugin's share of the
   vocabulary, settled by who loaded first and never by which verb raced. A manifest that
   contributes to either point and declares no namespace is refused by the schema.
3. **Plugin derivations are namespaced too, and bare names are Tyto's.** `derive jira.kind`,
   never `derive kind`. Tyto registers no derivation (ADR 0133); the bare names are kept so a
   later generic one cannot collide with a plugin's.
4. **Arguments are a small closed schema, as data.** Each is `{ name, type, positional?,
required?, values? }` with `type` one of `text`, `number`, `date`, `boolean`. The host
   checks a step against it before calling the plugin, so a misspelt argument is
   `E_RECIPE_ARGUMENTS` at its range, and the plugin is handed values already converted. No
   JSON Schema: a validator for it (ajv) would be a new dependency for four types.
5. **A table crosses as JSON and is checked twice on the host.** A strict Zod schema in
   `isolation/points.ts` refuses a wrong shape as `E_PLUGIN_PROTOCOL`; `checkTable` in
   `@tyto/recipe` — pure, so it guards a built-in the same way — refuses what a schema cannot
   say as `E_RECIPE_TABLE`: a column named twice, a row key empty or repeated, a value under no
   column or of another type than its column's.
6. **A source answers one page per call, and the host loops** (`pagedSource` in
   `@tyto/recipe`). A page is `{ table, cursor?, truncated? }`; no cursor is the last page.
   **Provisional ceilings**: 8 MiB of JSON and 5,000 rows per page, 100,000 rows per paged
   table, 1,000 pages; a transform's or a derivation's whole table is held to the 100,000. A
   repeated cursor, a page the source reports `truncated`, a page with other columns than the
   first, or a key two pages share is `E_RECIPE_SOURCE` — **never a partial table**. TYTO-386
   measures a real Jira page and moves the numbers.
7. **The adapter is `recipeRegistriesOf(registry)` in `plugin-api`**, which answers the
   runner's `VerbRegistry` and `DerivationRegistry` over the generic verbs and every
   contribution, read per lookup like `directiveResolverOf`. `plugin-api` may depend on
   `@tyto/recipe`; the reverse never. A plugin's diagnostic is placed at its cell, whatever
   range it wrote, because a plugin never sees the recipe's text.
8. **The protocol stays at 4.** The two points add registrations and callables, and both ends
   ship in one app; no message changes shape.
9. **`writes: string[]` sits at the manifest's top level**, and each action's or sink's
   `writes` is a subset of it; the host refuses an operation whose `write` is undeclared
   (ADR 0129 decision 3).
10. **An action or a sink answers a `Plan`**: `{ target, operations: [{ write, rowKey?,
description }], count }`, minimal on purpose. TYTO-378 adds `apply` and may only add
    fields.

    _Amended in the second pull request:_ a plan holds at most **10,000 operations**, each
    description at most 500 characters (`PLAN_LIMITS`, provisional like the page ceilings), and
    `checkPlan` in `@tyto/recipe` refuses past them as `E_RECIPE_PLAN`, never a plan shown in
    part. The same check refuses a `count` other than the number of operations and a `rowKey`
    the table the verb read does not hold. The table passes through an action or a sink
    unchanged, so a cell after it reads the same rows.

## Consequences

- TYTO-376 ships in two pull requests. The first carries decisions 1–8: sources, transforms,
  derivations, the namespace and the example plugin `examples/plugins/tyto-plugin-example-recipe`.
  It refuses a verb of kind `action` or `sink` at load, saying the kind arrives in a later
  version, so the second pull request (decisions 9 and 10) widens a check rather than
  retracting an accepted declaration.
- A source is several calls of under 30 s each rather than one of minutes: the deadline stays
  per call and is never raised for a slow search.
- A transform or a derivation still crosses the whole table in one call under one deadline. A
  100,000-row table that does not cross in 30 s is a later card, measured first.
- The ceilings are guesses with a card to replace them. A real page that passes one of them is
  an error a person can read, not an out-of-memory process.
- The connectors' authors read one rule: their names are `<namespace>.<name>`, and the
  namespace is theirs alone.
