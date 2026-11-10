# 0188 — The recipe runner lives in @tyto/io, for every host that runs a recipe

Status: accepted · 2026-11-10 · TYTO-664 · moves ADR 0148's runner · narrows AGENTS.md's
"composition happens in apps/\* only" for one composition

## Context

The recipe notebook's runner (`createRecipeRunner`, TYTO-377, ADR 0148) and its Apply
(`applyCell`, TYTO-378, ADR 0170) were written in `apps/desktop/src/main`. They compose the
installed plugins' verbs (`recipeRegistriesOf`, ADR 0135, ADR 0147), the workspace's data files
(`workspaceDataResolver`, ADR 0137), the recipe's state (`recipeStateStore`, ADR 0140), `to-brief`'s
ports (`workspaceBriefPorts`, ADR 0172) and `run x` reading `x.recipe` beside the recipe.

TYTO-565's last tool, `run_recipe` in `tyto mcp`, needs the same runner. `tyto mcp` lives in
`packages/command-line`, and no package imports an app. A second copy in the command line would
drift from the notebook's: when cells run, what a restricted folder withholds, which state a run
may write. Those rules are ADR 0148's and ADR 0170's and belong in one place.

Read on `origin/main` at 290c37db: the command line's `loadInstalledPlugins` activates every
installed plugin with `host.tryActivate(plugin, 'external')` on a `createPluginHost()` host, the
same call the desktop's `window-plugins.ts` makes. That host's registry is a `PluginRegistry`, which
extends `RecipeContributions`. So the command line needs no host work to hand a runner the
plugins' recipe verbs; the runner was the only thing out of reach.

AGENTS.md says composition happens in `apps/*` only, and that no package imports another
package's adapter.

## Decision

1. **`createRecipeRunner` and `applyCell` live in `@tyto/io`**, under `src/recipes/`, moved with
   their behaviour unchanged. `@tyto/io` exports the runner, its option and answer types,
   `INCLUDED_RECIPE_MAX_BYTES`, `oldestFetchedAt`, `readOnlyState` and the `AppliedRecord` type.
   - **Why `@tyto/io`.** It is already a Node package that depends on `@tyto/core` and
     `@tyto/plugin-api`, and every adapter the runner defaults to is its own. The move adds only
     `@tyto/recipe` to its dependencies, with no cycle. A new package would add a name to the
     changeset lists for a module that composes nothing outside io.
   - **Why this composition may leave `apps/*`.** It is a reusable composition of io's own
     adapters behind injectable ports: the plugins' contributions, the folder's trust and
     workspace (`placeOf`), each plugin's section (`sectionFor`), `TYTO_HOME`, the clock and the
     templates are options, and the registries, the state and the data resolver can each be
     replaced (as the tests do). Two apps run it: the desktop and `tyto mcp`. AGENTS.md's rule
     stands for everything else. A package still imports no other package's adapter, and an app
     still decides what the runner is handed.

2. **What stays in the desktop app:** `templateManifestsOf`, which reads the desktop's project
   snapshot (`ProjectSources`) and now sits beside it in `main/project.ts`; the scheduler
   (`recipe-schedule.ts`, ADR 0175); the window's wire (`recipe-wire.ts`), its rows, facets and
   clock; and the IPC channels. `recipe-runner.test.ts` stays in the desktop too, since it
   asserts what the window is sent through `recipeAnswerToWire`; `recipe-apply.test.ts` moves with
   Apply.

3. **The notebook's views move to `@tyto/recipe`.** `RECIPE_VIEWS` and `RecipeViewName` sit beside
   `ViewSpecs`, so every host checks `show` against the same list. `apps/desktop/shared/recipe-views.ts`
   re-exports them, so the window and main keep one import. The list is data and `@tyto/recipe`
   stays pure. A card that adds a view still adds its renderer in the desktop.

## Consequences

- `tyto mcp` can build a runner from the plugins it already loads (TYTO-565 PR 4), with no
  change to the plugin host.
- `@tyto/recipe` is part of the published plugin contract's closure (ADR 0149), so its next
  release carries `RECIPE_VIEWS`. A plugin may read it; nothing in a plugin needs to.
- A change to when cells run or what Apply writes is made once, in `@tyto/io`, and both hosts
  get it.
