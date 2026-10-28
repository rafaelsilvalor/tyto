# 0150 — A plugin's repository tests through the contract's testing entry

Status: accepted · 2026-10-27 · TYTO-445 · builds on ADR 0010, ADR 0041, ADR 0049 and ADR 0149

## Context

ADR 0149 published the contract, so a plugin in its own repository gets Tyto's types. Types do
not say a plugin still loads. `tyto-plugin-jira` validates its manifest against a copy of the
schema, and `tyto-plugin-estrategia` clones Tyto in its CI to build `@tyto/recipe` and run its
recipe. Neither runs the plugin through the checks the app runs it through: the engine range,
`tryActivate`'s refusals, the settings resolution, the protocol a registration crosses.

Tyto already does that in its own tests. `isolated-plugin.test.ts` runs a plugin through the
real `runGuest` and `connectIsolatedPlugin` over two in-memory queues, then `tryActivate`,
`resolveSettings` and `recipeRegistriesOf`. Every piece is pure, and none of it is exported as
one thing a plugin's test can call.

The card also asks that loading "a plugin folder" be part of it, and `@tyto/plugin-api` may not
read a disk (ADR 0010).

## Decision

1. **`@tyto/plugin-api/testing` is a second entry of the published package**, with one
   function, `testPlugin({ manifest, load, ... })`, whose other options are a plugin's
   `settings`, its project `section`, its `secrets`, a `fetch` and any other port. It applies the app's rules in the app's order —
   `checkInstallable` against the installed `PLUGIN_API_VERSION`, the guest behind
   `runGuest` and `connectIsolatedPlugin` over a channel that clones each message at the
   sender, `tryActivate` into a fresh host, `resolveSettings` over what was declared, and
   `configure` — and answers either the diagnostics the app refuses with or a harness: the host
   and its registry, the resolved settings and what they refused, `recipeRegistriesOf` with the
   plugin's section, a `runRecipe` that takes a fixed `RunClock`, the `host.log` lines, and the
   secrets as the plugin left them. It is a subpath rather than a package, because it is
   nothing but the contract composed, and it versions with the protocol it speaks.
2. **It reads no folder.** The caller hands over the manifest's text and an import of the
   built entry:

   ```ts
   const manifest = readFileSync(new URL('../tyto-plugin.json', import.meta.url), 'utf8');
   const harness = await testPlugin({ manifest, load: () => import('../dist/index.js') });
   ```

   A folder reader is a Node module. Inside `plugin-api` it breaks the runtime boundary; beside
   it it is a fifth published package, Node-only, to save the two lines above. The app's own
   folder rules that do need a disk — the link check, the approval state, `dist/index.js`
   existing — are the installed folder's, and a plugin's repository has no installed folder.

3. **The guest runs in the test's own process, and the harness does not exercise the sandbox.**
   `requireSandbox` is `false` and the guest reports a canary that was `readable`. The child
   process, its permission flags and the `denied` canary stay the CLI's and the desktop's to
   test (ADR 0049); a plugin that reads a file outside its folder passes the harness and is
   refused by the app.
4. **A refusal is held to the app's, not described beside it.** The harness's tests run every
   refusal through both the harness and `startInstalledPlugins` + `activateInstalled`, the half
   the CLI and the desktop share, and require the app's `W_PLUGIN_SKIPPED` to carry the
   harness's message.

## Consequences

- A plugin's repository runs its recipe verbs, its settings and its refusals without a Tyto
  checkout, in the same `vitest` run as its unit tests. Moving `tyto-plugin-jira` and
  `tyto-plugin-estrategia` onto it is TYTO-446.
- A declared point the plugin never registers into is accepted, by the harness and by the app
  alike (`host.test.ts`, "allows a declared point the plugin did not register into"). The card
  named it as a refusal; what the app refuses is the opposite, a registration into a point the
  manifest does not declare.
- A template's repository needs more than this: compiling a brief against a template and
  exporting its HTML needs `brief-lang`, `export-html` and faces, none of which is in the
  contract. That helper is a card of its own.
- The harness answers for the in-process host. A rasterizer or an exporter a plugin contributes
  is listed in `host.registry`, and nothing here renders through it.

## Rejected

- **A Node helper that reads the folder**, in `plugin-api` or as its own package — see 2.
- **Running the guest in a real child process.** It needs the CLI's launcher, which is Node and
  an app's adapter; and a plugin's tests would then depend on its machine's ability to confine
  a process, which is not what they test.
- **Exporting `isolated-plugin.test.ts`'s helpers as they are.** They take an `activate`
  function and a manifest object, which skips the two checks a plugin's repository most needs:
  its manifest as text, and the module its build actually produced.
