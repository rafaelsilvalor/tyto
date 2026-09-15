# Architecture

## Pipeline (it is a compiler)

```
brief.brief ──parse──▶ AST ──compile──▶ Scene ──export-html──▶ HTML ──raster──▶ PNG/JPG/WebP
                          │(manifest)      │
                       validate            └──export-svg──▶ SVG
```

Every arrow is a pure function `(input) → Result<output, Diagnostic[]>`. Stages do not know each other; `pipeline` composes them.

| Stage   | Package                     | Input → Output                                                                                                                          |
| ------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| parse   | `brief-lang`                | text → `BriefAst` (frontmatter + directives + rich text)                                                                                |
| resolve | `core`                      | `BriefAst` + `TemplateRegistry` → `ResolvedBrief` (typed slots, adjustments validated against the manifest)                             |
| compile | `core`                      | `ResolvedBrief` × template → `Scene` (one `Artwork` per slide, one `Frame` per format; text measured and wrapped when `faces` is given) |
| export  | `export-html`, `export-svg` | `Scene` → string per `Frame`                                                                                                            |
| raster  | `raster` (port)             | HTML → image bytes                                                                                                                      |
| deliver | `io` (port)                 | artifacts → fs / …                                                                                                                      |

## Packages

```
packages/
  core           Scene IR (Zod), Result/Diagnostic, template SDK, resolve+compile, TemplateRegistry
  brief-lang     Lezer grammar + parser → BriefAst; also powers editor highlighting
  template-lang  grammar + parser for the HTML-like template markup → template function
  export-html    Scene → HTML/CSS (SceneVisitor)
  export-svg     Scene → SVG (SceneVisitor)
  raster         Rasterizer port + chromium adapter (Electron offscreen or Playwright)
  templates      built-in templates (template-pack plugin)
  fonts          the faces Tyto ships, and the reader that hands them to the exporters and to measurement
  pipeline       Job: brief → artworks×formats → artifacts; local queue, cancellation, progress
  plugin-api     extension-point types, PluginHost, plugin manifest, permissions
  io             BriefSource/OutputSink ports; fs adapters (inbox/outbox); local watcher
  sources        (deferred, ADR 0011) jira/trello/notion/sheets/drive plugins
  editor         CodeMirror 6: brief and template languages, vim, diagnostics, manifest-driven autocomplete
apps/
  cli            commander: render, watch, template new|check, plugin install|list
  desktop        electron-vite: main (pipeline, plugins, credentials) / preload / renderer (editor, preview, panels)
```

Runtime boundary — **pure** (no Node/DOM): core, brief-lang, template-lang, export-*, templates, plugin-api (types). **Node**: raster, pipeline, io, fonts, sources, cli. **DOM**: editor, desktop/renderer.

Path to the cloud: same pure code; `raster` swaps to Playwright in a container, `io` swaps to HTTP + bucket, `pipeline` runs as a worker consuming a queue. No pure package changes.

## Patterns and where they live

- **Hexagonal (ports & adapters)** — a port is declared by the package that _consumes_ it, not in one central place: `FileSystem`, `AssetResolver` and `FontSource` in `core` because the pure stages ask them questions, `Rasterizer` in `raster`, `BriefSource`/`OutputSink` in `io`, `TemplateSource`/`ArtifactSink` in `pipeline`, and `BriefAnalyzer` in `editor` — the editor is what wants a brief checked as it is typed, and running the check needs a registry and a disk it may not reach, so the host fills the port (in process, or across a worker). Adapters live beside their runtime (`raster`, `io`, `fonts`, `sources`); composition only in `apps/*`.
- **Compiler pipeline** — pure stages, tested in isolation with fixtures.
- **Visitor** — `SceneVisitor<T>` and `walk()` in `core`; each exporter implements one and none of them writes the recursion again. The walk hands every node its accumulated transform, effective opacity, ancestor chain and frame. New output format = new visitor.
- **Registry** — `TemplateRegistry` and `PluginRegistry`: folder discovery, manifest read without executing code.
- **Command** — editor: every edit is a `Command { execute, undo }`; keymaps map to commands; plugins register commands.
- **Result/Diagnostic** — errors are data with `severity`, `code`, `message`, `range`; they travel to the UI and to `result.json`.
- **Typed event bus** — `desktop`: main↔renderer channel through preload with contracts in `apps/desktop/shared`.
- **Strategy** — `Rasterizer` (chromium today; other backends later) and `OutputSink`.
- **Job** — `pipeline` composes the stages and owns the five decisions no single stage can make alone: the order they run in, **when the bytes are loaded**, what the files are called, how many frames raster at once, and what happens when one frame of twelve is broken. It walks the frames itself rather than calling `exportHtml`/`exportSvg`, because those fail a whole scene and an author should see every broken frame in one run.
- **Resources are loaded between `compile` and `render`**, through `JobPorts.loadResources`, and that window is the whole of it. An exporter's `asset` and `font` lookups are synchronous — a `SceneVisitor` cannot await — so the bytes must be in memory before the first walk; but _which_ bytes is a question only a `Scene` answers, and the scene is made inside the job. `sceneResources(scene)` in `core` is the answer, one list of `AssetRef`s and one of `SceneFontFace`s, deduplicated. Before this the only way out was to read the whole asset folder before the job started, which is right for one issue's attachments and wrong for a shared library — and impossible for fonts, which have no folder to read because a face is a `(family, weight, style)` triple that exists only in a `TextSpan`.

## Desktop processes

```
renderer (Chromium, no Node)   preload (typed bridge)   main (Node)
  CodeMirror editor        ◀──────── IPC ────────▶      pipeline, TemplateRegistry
  per-format preview                                    PluginHost (utilityProcess per plugin)
  local queue / jobs panel                              inbox watcher, safeStorage
```

Raster on desktop uses an offscreen `BrowserWindow` in main (`webContents.capturePage`); the CLI uses Playwright. Both implement `Rasterizer`.

**The live preview does not raster, and that is the one place the desktop stops short of the pipeline on purpose.** `brief:preview` runs parse → resolve → compile → `exportHtml` in main and sends the **HTML** across; the renderer shows each frame in a `sandbox=""` `<iframe srcdoc>`, at its own size, scaled by a transform. Rasterizing would mean encoding a PNG so that Chromium could decode it and draw it — a round trip into and out of an image whose only products are latency and a lossy copy, when the destination was already a browser. Bytes are still what an _export_ means (E9.4), and that is where `Rasterizer` stays.

Two consequences are worth naming. The preview inherits the window's Content-Security-Policy, so `font-src 'self' data:` is in `index.html` for the sake of the embedded faces rather than for the shell. And the preview is independent of E5.4, which is what let E9.2 ship while the offscreen rasterizer was still unverifiable (TYTO-30).

**`@tyto/fonts` and `@tyto/templates` are the two packages the desktop must not bundle.** Both answer a question with a folder of bytes rather than with code — the templates' manifests and the faces — and both find that folder relative to themselves: `createRequire(...).resolve('@tyto/templates/package.json')`, and `../fonts` from `@tyto/fonts`'s own module. Inlined into `out/main/index.js` the second resolves to `out/fonts` and every render dies with `cannot read …/out/fonts/…`. So `electron.vite.config.ts` externalises them and `electron-builder.yml` ships them beside the bundle. Anything else that reads its own folder joins that list.

**The renderer is Lit components in light DOM, and the window's layout is meant to become data** (ADR 0024). `<tyto-problems>` is the first one: it owns its own strings, so a locale change is a property change rather than a second pass over the document, and `repeat` keyed by a diagnostic's code and span rewrites only the rows that moved — 0.14 ms against 1.62 ms for the `replaceChildren` painter it replaced, on the same two hundred rows. Three painters are still hand-written (the `[data-i18n]` walk, the preview pane, the two `<select>` fillers) and the same measurement says they are not costing anything, so they stay until a card needs them to move. Light DOM and not shadow, so `shell.css` reaches inside every panel; a custom element therefore needs an explicit `display` there, because an unknown tag is `display: inline` and `flex` and `overflow` do nothing on one.

**The renderer will not run in a browser tab**, and five comments used to say it would (ADR 0024). What survived that premise is what never depended on it: the window's own Content-Security-Policy is why a template's `preview.png` crosses the bridge as bytes, and the first paint happening before main answers is why `window.tyto` is optional. The two things the premise was confused with are untouched — the window still has a browser tab's powers and not a Node process's (ADR 0001), and the pure packages still run in any runtime (ADR 0010), which is the one that actually makes the cloud possible.

**One workspace, two runtimes.** `apps/desktop` is the only package that is both, and the split is declared three times so that no one of them can be the only thing holding it: `eslint.config.js` lists `src/main` and `src/preload` as Node and `src/renderer` as DOM, `tsconfig.json` and `tsconfig.renderer.json` give each half only the libraries it may see, and `electron.vite.config.ts` builds them separately. `shared/` is the fourth category — linted as **pure**, because it is the one folder both halves import and neither may shape.

**What crosses the bridge is declared once, in `apps/desktop/shared/ipc.ts`.** One table of channels, each with a Zod schema for the request and one for the response. Main registers its handlers by walking that table, so a channel with no handler is a type error rather than a call that hangs; the preload builds `window.tyto` from the same table, so the API the renderer programs against is the contract by construction. Both sides validate: main because it may not trust another process, the preload because it is the only place that can refuse before the message is sent, on the caller's own stack. `shared/i18n/` is the same idea for strings — one `Catalogue` type, so a locale missing a key does not compile.

**A diagnostic's `range` survives the whole pipeline; an artwork's has to be caught on the way past.** The problems panel (E9.3) lists what the stages said and puts the cursor on the span each one names, which costs nothing: a `Diagnostic` carries its `range` to the end. Selecting a slide scrolls the editor to the `::directive` that made it, and that number exists only in `resolve` — a `Scene` has no source position at all, so by the time a frame exists it is three stages gone. `brief:preview` therefore answers with an `artworks` list beside `frames`, built by zipping `scene.artworks` against `resolved.artworks` by position, which `compile` guarantees is one to one. The template picker is the same shape in reverse: it rewrites the frontmatter's `template:` line as an ordinary editor edit, so the preview, the panel and the undo history all follow the path typing already takes.

**The end-to-end suite is not part of `pnpm check`.** `pnpm --filter @tyto/desktop test:desktop` launches a real Electron through Playwright and asserts what no unit can reach: the three `webPreferences` flags, by name and by consequence, and that the preload actually put the bridge on the page. It downloads a ~246 MB binary on first use, which is why it sits outside the default run, the same arrangement `packages/raster` makes for its visual suite.

**There is a second one, and it is a different program.** `test:desktop` launches the app this repository has on disk, which can reach a `node_modules` with 472 packages in it; `pnpm --filter @tyto/desktop test:package` runs `electron-builder --dir` first and launches what came out, which reaches only what the `files` list in `electron-builder.yml` carried. The gap is not theoretical: `builtInTemplatesDirectory()` resolves `@tyto/templates/package.json` through `createRequire`, a bundle cannot answer a resolver, and a package built without that folder **opens no window at all** rather than opening one with no templates. `docs/git-workflow.md` has the release this protects.

## Design directives

1. The IR is the single source of truth for the artwork. If it is not in the IR, it does not exist.
2. Templates produce IR, never HTML. Both the TS path and the HTML-like path converge on `Scene`.
3. Anything that can be validated without executing code (manifest, plugin.json) is validated before execution.
4. Determinism: same brief + templates + fonts ⇒ same bytes. Fonts are bundled/pinned; never `system-ui`. `@tyto/fonts` is where bundled means something an install has (ADR 0021); a face nobody bundles is `E_EXPORT_FONT_UNRESOLVED` naming it, never a substitute.
