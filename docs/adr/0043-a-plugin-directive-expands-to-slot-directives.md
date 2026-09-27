# 0043 — A plugin directive expands to slot directives

Status: accepted · 2026-09-27 · TYTO-49 · narrows the `directive` row of `docs/plugin-api.md`

## Context

`docs/plugin-api.md` said a `directive` contribution "transforms AST/ResolvedBrief". Nothing
implemented it. The grammar parsed `::ns/name` from E3.1 on, and `resolve` answered every one
with `E_UNKNOWN_DIRECTIVE`. TYTO-49 wires resolution, and it has to decide what a plugin may
change.

A `ResolvedBrief` is the output of the manifest check. Its slots have already been typed against
the template, `min`/`max` counted, enum values matched, assets hashed and required slots noted.
A plugin that could write into it would skip every one of those checks. A plugin in a worker
thread (ADR 0041) would also need the whole `ResolvedBrief` schema to cross the boundary, both
ways, for each directive.

## Decision

**A plugin directive's transform is handed the directive as parsed and answers with ordinary
slot directives.** `resolve` takes each replacement exactly as if the author had typed it. A slot
the manifest lacks is `E_UNKNOWN_SLOT`, a value it refuses is `E_BAD_SLOT_VALUE`, and a required
slot the brief still leaves unset is `E_MISSING_REQUIRED_SLOT`. A plugin never touches a
`ResolvedBrief`.

This narrows the documented "AST/ResolvedBrief" to "AST in, slot directives out", on purpose. The
safety argument above is one reason. The other is that every example the docs give is this
shape: `::ai/caption` produces a caption slot.

- **The port is core's.** `ResolveOptions.directives` is a `DirectiveResolver`, declared in
  `packages/core/src/brief/directives.ts` because `resolve` consumes it (the hexagonal rule in
  `docs/architecture.md`). `directiveResolverOf` in `@tyto/plugin-api` adapts the host's
  `directive` point to it.
- **The contribution's `id` is its namespace.** `::demo/shout` routes to the contribution whose
  id is `demo`, and `names` lists what it answers. Two plugins that claim one namespace are
  `E_PLUGIN_DUPLICATE`, through the check every point already has. A namespace the host knows
  with a name it does not declare is `E_UNKNOWN_DIRECTIVE`, like an unknown namespace.
- **A plugin's arguments are its adjustments, parsed and ranged.** The grammar has no argument
  node. Reading "the first word of the body" as an argument would be a convention the parser knows
  nothing about. So `::demo/shout {slot: titulo} Direito` passes `slot` as a parsed
  `Adjustment`, with its range. On a plugin directive the adjustments belong to the plugin and are
  **not** checked against `manifest.adjustments`. They reach a replacement only if the plugin
  puts them there.
- **The host stamps every position.** A replacement carries no ranges. Each range in it, and in
  any plugin diagnostic that has none, is the plugin directive's own, and its `nameRange` is the
  plugin directive's name. A plugin has no text of its own to point into, and a range it chose
  could point anywhere in somebody's brief.
- **No recursion.** A replacement has no namespace. In isolation the answer schema is strict, so a
  replacement carrying a `namespace` is `E_PLUGIN_PROTOCOL` rather than being dropped in silence.
  Expansion is one step, so a plugin cannot loop the resolver or hand its work to a plugin the
  author did not ask for.
- **Isolated like an exporter.** `directive` joins `ISOLATED_POINTS` with `transform` as a callable.
  It uses the same call-by-id and the same per-call deadline (ADR 0042), and a timeout, crash or
  throw answers a non-fatal diagnostic. Stamping puts that diagnostic on the directive, and every
  other directive still resolves.
- **A plugin's own complaint has a code.** `E_DIRECTIVE_ARGUMENT`, non-fatal: the directive
  contributes nothing and the brief resolves without it.

## Consequences

- A plugin directive can do what an author can type, and nothing more. A plugin that needs more
  (build a slide from a remote query, inject an asset) needs a new ADR, not a looser answer
  schema.
- **Known limit of plugin arguments: an adjustment value is the grammar's `value` token,
  `[a-zA-Z0-9_-]+`.** `{slot: sub.titulo}` does not parse whole. The value stops at `sub`, the
  rest of the list is two `E_SYNTAX`, and the plugin still runs with the part that parsed. This is
  measured in `apps/cli/src/plugin-install.test.ts`. An argument node in the grammar is an E3
  change for the day a real plugin needs one.
- The editor offers `ns/name` after `::` from the host's list (`directiveNamesOf`), and resolves
  through the same port when the host hands it a resolver. The desktop hands it neither yet,
  because it activates no installed plugin (TYTO-48's desktop half).
- A replacement's diagnostics all point at the plugin directive, never inside its body. That is
  coarser than a typed directive's, and it is true.
