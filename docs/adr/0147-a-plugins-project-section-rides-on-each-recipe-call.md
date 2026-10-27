# 0147 — A plugin's project section rides on each recipe call

Status: accepted · 2026-10-27 · TYTO-428 · amends ADR 0145 (decision 5) and ADR 0127 (decision
4); builds on ADR 0011, ADR 0111, ADR 0112, ADR 0117, ADR 0134, ADR 0135 and ADR 0138

## Context

ADR 0127 decision 4 put what is one company's — field ids, sheet ids, a site's base URL — in
the plugin's section of the workspace's `.tyto/project.json` (ADR 0112). `resolveProject`
already holds one opaque section per plugin id, merges the work profile's and the folder's
(the folder wins) and withholds every section of a restricted sheet with
`W_PROJECT_SECTIONS_WITHHELD` (ADR 0111). Only one door led from there to a plugin: `section`
on an `asset-source` or `font-source` call (ADR 0117). The recipe verbs a connector is made of
(ADR 0135) were handed `{ arguments, cursor }` or `{ arguments, table }` and nothing else.

ADR 0145 decision 5 named the way it would get there: read the section as a list of entries,
pass it through `resolveSettings` and hand it to the plugin with `configure`. That door is
wrong on three counts:

- **`configure` is process-wide and the last one wins** (ADR 0145 decision 4). One isolated
  plugin serves every window and every run; a folder's values sent through it would still be
  there when the next folder's recipe runs — the leak between folders ADR 0138 refuses for the
  workspace's files, where the folder and its trust are read on every call.
- **A form has no object in v1**, and a section is whatever the plugin keeps there: a status
  graph, a table of field ids.
- **Sources already get the section raw**, unvalidated, on each call. Two shapes for the same
  value would be one too many.

## Decision

1. **Every recipe verb call carries `section`, as a source call does.** `PageRequest`,
   `TransformRequest` and `PlanRequest` gain `section?: unknown` (`VerbRequest`): the verb's
   own plugin's section of the resolved project. **Absent — not `{}`, not the last folder's —
   when the folder has none or is restricted.**
2. **The per-plugin filter is in `recipeRegistriesOf`.** It takes
   `{ sectionOf?, limits?, planLimits? }`; the registry exposes each verb with the plugin that
   registered it (`ownedRecipeVerbs`, as `assetSources` does), and the verb is bound to
   `sectionOf(owner)`, asked on every call. A verb never sees another plugin's section, and a
   folder trusted or edited between two runs is what the next call reads. `packages/recipe` is
   unchanged: its `VerbContext` knows no plugin.
3. **The host does not validate the section.** It is the plugin's data (ADR 0011, ADR 0112): the
   plugin answers its own diagnostics, which the existing placement puts at the verb.
4. **Two channels, kept apart.** `host.config` is the person's settings — the desktop's
   `settings.json`, the CLI's declared defaults — the same in every folder. `section` is what
   this folder chooses. Plugin authors treat the section as overriding the settings. **A
   secret never goes in a section** (ADR 0134): the file is plain text a team shares.
5. **`tyto render --section <plugin>.<key>=<value>`, repeatable.** The value is JSON when it
   parses and the typed text otherwise; the keys are shallow-merged over the file's section
   for that plugin. It applies in a restricted folder too, where the file's sections stay
   withheld: the person typing the command is the approval, as `tyto trust add` takes it. A
   flag of another shape is a usage error, exit 1, like every malformed flag. It reaches
   sources today (a restricted folder fetches nothing, ADR 0118, so there it waits for a
   caller that runs) and the verbs once the CLI runs recipes.
6. **Protocol 8.** The strict wire schemas of `page`, `transform` and `plan` accept `section`;
   a guest on 7 would refuse a call that carries one, so it is refused at `hello` instead.
7. **Commands adopt the same field.** When TYTO-261 makes `editor.command` run, its call carries
   the plugin's `section` on the same terms. The desktop passes `sectionOf`, read per call from
   the open folder, when the recipe notebook runs recipes; nothing in the window does yet.

## Consequences

- `plugin-api` gains `VerbRequest`, `OwnedRecipeVerb`, `RecipeRegistryOptions` and
  `PluginRegistry.ownedRecipeVerbs`; `recipeRegistriesOf` takes an options object instead of
  two positional limits. A minor version. `RPC_PROTOCOL_VERSION` is 8.
- ADR 0145 decision 5's last sentences and its "Out" bullet on per-workspace values are
  replaced by this ADR; the CLI's `configureDefaults` comment says so.
- ADR 0127 decision 4 now has its delivery: the section reaches every verb, source and, with
  TYTO-261, command of the plugin, on each call.
- Out: a schema a plugin could declare for its section so the window could check and outline
  it; nesting in `--section` (`jira.fields.status=…` sets the key `fields.status`).

## Note, 2026-10-27 — `sectionOf` composed in the desktop (TYTO-377)

The desktop's recipe runner passes `sectionOf` (ADR 0148): `WorkspaceService.sectionFor` reads
the open folder's resolved sections on every call, for a recipe inside the open folder, and
answers nothing outside it. The runner hands a section on only in a trusted folder, on top
of the sections `loadWorkspace` already withheld, so Run in a restricted folder hands no verb
a section.
