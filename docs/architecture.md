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
  editor         CodeMirror 6: brief and template languages, vim, diagnostics, manifest-driven autocomplete, find/replace
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
- **Result/Diagnostic** — errors are data with `severity`, `code`, `message`, `range`; they travel to the UI and to `result.json`. A code also carries whether it is **fatal** — whether a stage that met it can still hand back part of its value — which is a separate question from severity and the one that decides what gets drawn (ADR 0025).
- **Typed event bus** — `desktop`: main↔renderer channel through preload with contracts in `apps/desktop/shared`.
- **Strategy** — `Rasterizer` (chromium today; other backends later) and `OutputSink`.
- **Job** — `pipeline` composes the stages and owns the five decisions no single stage can make alone: the order they run in, **when the bytes are loaded**, what the files are called, how many frames raster at once, and what happens when one frame of twelve is broken. It walks the frames itself rather than calling `exportHtml`/`exportSvg`, because those fail a whole scene and an author should see every broken frame in one run. **And it reports the frames that worked**: a failed frame is not fatal (ADR 0025), so the job comes back on the ok branch carrying its report and the errors together, and `result.json` names the files that reached the sink instead of claiming there were none.
- **Resources are loaded between `compile` and `render`**, through `JobPorts.loadResources`, and that window is the whole of it. An exporter's `asset` and `font` lookups are synchronous — a `SceneVisitor` cannot await — so the bytes must be in memory before the first walk; but _which_ bytes is a question only a `Scene` answers, and the scene is made inside the job. `sceneResources(scene)` in `core` is the answer, one list of `AssetRef`s and one of `SceneFontFace`s, deduplicated. Before this the only way out was to read the whole asset folder before the job started, which is right for one issue's attachments and wrong for a shared library — and impossible for fonts, which have no folder to read because a face is a `(family, weight, style)` triple that exists only in a `TextSpan`.

## Desktop processes

```
renderer (Chromium, no Node)   preload (typed bridge)   main (Node)
  CodeMirror editor        ◀──────── IPC ────────▶      pipeline, TemplateRegistry
  per-format preview                                    PluginHost (utilityProcess per plugin)
  local queue / jobs panel                              inbox watcher, safeStorage
```

Raster on desktop is a hidden `BrowserWindow` in main, captured through `webContents.debugger` — `Emulation.setDeviceMetricsOverride` then `Page.captureScreenshot` (ADR 0027, amending ADR 0002); the CLI uses Playwright. Both implement `Rasterizer`.

**The picture does not come from the window's own surface, and that is the whole of the amendment.** Every route that reads that surface — `capturePage`, the offscreen `paint` event, `beginFrameSubscription` — returns a frame clipped to the primary display's work area, so a 1080×1920 story came back 1080×1680 on a 3072×1680 desktop and 1080×1024 under CI's 1280×1024 `xvfb`, at 100% painted coverage with nothing in the bytes saying a third of the artwork was missing. The debugger renders past the viewport instead, which is also what gives the desktop `webp` and `scale: 2` — `NativeImage` encodes neither.

**The live preview does not raster, and that is the one place the desktop stops short of the pipeline on purpose.** `brief:preview` runs parse → resolve → compile → `exportHtml` in main and sends the **HTML** across; the renderer shows each frame in a `sandbox=""` `<iframe srcdoc>`, at its own size, scaled by a transform. Rasterizing would mean encoding a PNG so that Chromium could decode it and draw it — a round trip into and out of an image whose only products are latency and a lossy copy, when the destination was already a browser. Bytes are still what an _export_ means (E9.4), and that is where `Rasterizer` stays.

Two consequences are worth naming. The preview inherits the window's Content-Security-Policy, so `font-src 'self' data:` is in `index.html` for the sake of the embedded faces rather than for the shell. And the preview is independent of E5.4, which is what let E9.2 ship while the desktop rasterizer was unverifiable on win32 (TYTO-30) and then, once measured, unbuilt until TYTO-133 — the mechanism is ADR 0027's and the adapter is `apps/desktop/src/main/rasterizer.ts`.

**The adapter lives in the app and not in `@tyto/raster`, which is the opposite of where the Playwright one lives.** The rule is the same in both cases — a package may hold an adapter, and only `apps/*` may choose one — and what separates them is the dependency. `playwright` is an optional peer any Node process can install; `electron` exists only inside a running Electron, and `@tyto/raster` has a single entry point that the CLI imports, so an Electron adapter re-exported from there would put that peer in front of a process that will never be one. The app registers it through the plugin host, under the same `chromium` id the CLI uses for its own (ADR 0007).

**Two of three reference fixtures compare across the two adapters, and the third does not.** `shapes.feed` and `alpha.square` are measured against `packages/raster`'s committed Playwright references from the desktop suite — 0.0656% and 0.0000% against a 0.1% tolerance — and that is E5.4's acceptance criterion met. `text.feed` is not: the two adapters drive different Chromium builds (Electron's 152.0.7977.78 against Playwright's 153.0.8010.12) and glyph rasterization changes between them, so it is 1.2219% and it is compared against a reference this adapter recorded instead. The shipped app applies no determinism flags, because all five are visible in the window and none of them changes that verdict (ADR 0028).

**`@tyto/fonts` and `@tyto/templates` are the two packages the desktop must not bundle.** Both answer a question with a folder of bytes rather than with code — the templates' manifests and the faces — and both find that folder relative to themselves: `createRequire(...).resolve('@tyto/templates/package.json')`, and `../fonts` from `@tyto/fonts`'s own module. Inlined into `out/main/index.js` the second resolves to `out/fonts` and every render dies with `cannot read …/out/fonts/…`. So `electron.vite.config.ts` externalises them and `electron-builder.yml` ships them beside the bundle. Anything else that reads its own folder joins that list.

**The renderer is Lit components in light DOM, and the window's layout is meant to become data** (ADR 0024). `<tyto-problems>` is the first one: it owns its own strings, so a locale change is a property change rather than a second pass over the document, and `repeat` keyed by a diagnostic's code and span rewrites only the rows that moved — 0.14 ms against 1.62 ms for the `replaceChildren` painter it replaced, on the same two hundred rows. Three painters are still hand-written (the `[data-i18n]` walk, the preview pane, the two `<select>` fillers) and the same measurement says they are not costing anything, so they stay until a card needs them to move. Light DOM and not shadow, so `shell.css` reaches inside every panel; a custom element therefore needs an explicit `display` there, because an unknown tag is `display: inline` and `flex` and `overflow` do nothing on one.

**The window's layout is a record, not markup** (E9.10). `index.html` declares four empty docks — left, centre, right, bottom — a splitter each and a status bar, and says nothing about what goes in them. `shared/layout.ts` holds one entry per panel (`{ id, element, dock, open, size, fixed }`), `src/renderer/dock.ts` creates the element each open panel names and gives each dock its size, and `layout.json` beside the credential store remembers it (ADR 0009). A closed panel's element is not created, so a repaint does not walk it. One panel is `fixed` — the editor, because closing it unmounts CodeMirror and destroys the buffer — and that is a field rather than a rule, so tabs or a save prompt can take it off. Dragging a panel between docks is not built; the record is shaped so that it is a change to values.

**Several briefs are open at once, and the renderer's state is per document** (E9.11). `src/renderer/documents.ts` holds a `Workspace` — a list of documents and the id of the active one — and every painter reads the active one rather than a module-level singleton. A document carries its `EditorState` (text, undo history and cursor, opaque and `@tyto/editor`'s), where the pane that showed it was scrolled, its frames and artworks, its selected format and slide, its zoom and its diagnostics. One CodeMirror serves all of them: switching `editor.restore()`s the document being entered, which is what keeps an undo history inside its own tab — a `setValue` would throw it away. The editor panel therefore stays `fixed`: the states survive, but the view that can show one does not.

**The store owns the content and the view only shows it** (D1 of `docs/explorations/2026-09-16-document-buffer-model.md`, TYTO-115). `editor.onUpdate` writes the state of every transaction into the active document, so "what does this tab say right now" is a question the workspace answers for **every** document rather than only for the one CodeMirror is showing. It used to be the reverse — the store held a copy refreshed when a document stopped being active, stale on purpose for exactly as long as it was in front, and five call sites in `main.ts` therefore asked the view for the text. That is what made a derived unsaved marker (TYTO-112) and a session restore (TYTO-113) unwritable: both ask a question only the editor could answer, about tabs the editor is not showing. Scroll is the one thing still captured at a hand-off, because it is the **pane's** and not the document's (D7) and measuring it costs a layout flush. `textOf(state)` is the only field read `@tyto/editor` offers, so the shape stays the package's.

**Which tab a message is about travels with the message.** Main files one path per document id (`src/main/documents.ts`), so `brief:preview` carries a `documentId` and the preview resolves `assets/logo.png` against _that_ tab's folder. A channel that moved a pointer instead would race: previews are debounced and answer out of order on purpose, so an activate arriving between a request and its compile would resolve one document against another's folder. `file:open` and `file:reopen` answer with the id that ended up holding the file, which is not always the one that asked — a file already open is that tab, and main is the only side that can tell.

**Exactly one tab holds a path, and a save-as is the only thing that can break that.** Opening a file the window already has goes to the tab that has it; saving deliberately does the opposite and gives the path to the tab that asked, because moving somebody away from the text they just wrote would be worse. So the other tab lets go, and `file:save` answers with `released` naming it (TYTO-104) — main cannot tell it directly, for the same reason the menu cannot ask before reloading. The released tab keeps every character it had; what it loses is its name and the file its text was in, and the next save there has to ask where to put it.

**Whether a tab has unsaved work is compared, never remembered** (ADR 0026, ratifying D3 of `docs/explorations/2026-09-16-document-buffer-model.md`). A document carries the text that is in its file — `savedText` — and the dot is `contentOf(document) !== document.savedText`, which is why undoing back to what is on disk clears it and why nothing anywhere assigns a marker. **A document in no file compares against the empty string**, and that is one rule and not three: the untitled tab the window opens on is clean, a tab emptied of everything is clean, and a released tab is unsaved for as long as it holds a character. It is also what makes `isDisposable` two clauses instead of three — the old `brief === ''` guarded against text put into a buffer that notified nobody, and a comparison cannot be wrong about that. `savedText` moves in four places and no others: three where the document and a disk agreed — a new document; a file arriving through `file:open`/`file:reopen`, read back out of the buffer CodeMirror built from it rather than from the bytes, because CodeMirror normalises line endings and a CR LF brief is a supported input (TYTO-64), so comparing against the bytes would mark every one of those files unsaved the instant it opened; and the string `file:save` reports having written, never the buffer as it stands when the answer lands, because a save-as dialog is something a person can go on typing behind — and `releaseDocument`, which empties it, which is the write the released-tab rule above rests on.

**The app installs its own menu, because two default accelerators destroy work** (`src/main/menu.ts`). Electron's default menu carries `CommandOrControl+W` on _Close Window_ and `CommandOrControl+R` on _Reload_, a menu accelerator is handled before the page sees the key, and both keys now mean something in the window: `Mod-W` closes a tab, and a reload tears the renderer down with every document's text, undo history, cursor and scroll inside it — every open tab at once, unsaved ones included (TYTO-104). So the View and Window submenus are written out item for item, with `reload`, `forceReload` and `close` left out and everything else kept. Reload was the one with a choice, and asking first is what could not be built: main does not know whether any tab is dirty, because the workspace is the renderer's and every channel in `shared/ipc.ts` is a question the renderer asks — `dialog:confirm` included. A prompt from a menu click would need a message travelling the other way, which this app has none of.

The menu is otherwise Electron's own roles — `editMenu` is what makes copy and paste work on macOS — and removing it outright is not an option for that reason. The failure is invisible to Playwright, which dispatches keys straight into the renderer through the debugger, so `e2e/tabs.desktop.test.ts` asserts the accelerator table rather than pressing the key. **A template cannot assert the same thing**, and that is worth knowing before writing the unit test: a bare `{ role: 'viewMenu' }` contains no `reload` either, because the items are Electron's and appear in `buildFromTemplate`. What `src/main/menu.test.ts` can honestly say is whether the submenu is this repository's or delegated, and delegating is the failure.

**The renderer will not run in a browser tab**, and five comments used to say it would (ADR 0024). What survived that premise is what never depended on it: the window's own Content-Security-Policy is why a template's `preview.png` crosses the bridge as bytes, and the first paint happening before main answers is why `window.tyto` is optional. The two things the premise was confused with are untouched — the window still has a browser tab's powers and not a Node process's (ADR 0001), and the pure packages still run in any runtime (ADR 0010), which is the one that actually makes the cloud possible.

**One workspace, two runtimes.** `apps/desktop` is the only package that is both, and the split is declared three times so that no one of them can be the only thing holding it: `eslint.config.js` lists `src/main` and `src/preload` as Node and `src/renderer` as DOM, `tsconfig.json` and `tsconfig.renderer.json` give each half only the libraries it may see, and `electron.vite.config.ts` builds them separately. `shared/` is the fourth category — linted as **pure**, because it is the one folder both halves import and neither may shape.

**What crosses the bridge is declared once, in `apps/desktop/shared/ipc.ts`.** One table of channels, each with a Zod schema for the request and one for the response. Main registers its handlers by walking that table, so a channel with no handler is a type error rather than a call that hangs; the preload builds `window.tyto` from the same table, so the API the renderer programs against is the contract by construction. Both sides validate: main because it may not trust another process, the preload because it is the only place that can refuse before the message is sent, on the caller's own stack. `shared/i18n/` is the same idea for strings — one `Catalogue` type, so a locale missing a key does not compile.

**`@tyto/editor` owns no words, with one exception it had to take** (E8.5). Every other
user-facing string in that package is a label the desktop overrides at the point of display —
`COMMAND_LABELS` maps `editor.undo` to a catalogue key, and the English in `commands.ts` is
what a host with no catalogue falls back to. The find-and-replace panel cannot work that way:
it is `@codemirror/search`'s own DOM and nothing outside reaches into it. CodeMirror's answer
is the `EditorState.phrases` facet, and the measurement that made this safe is that **all
seventeen of the panel's strings go through it** — checked against the installed package,
because one literal rendered any other way would have meant writing a replacement panel. So
`EditorOptions.searchPhrases` takes them, `src/renderer/search-phrases.ts` in the desktop maps
each of CodeMirror's keys to a catalogue key, and the panel is translated rather than rebuilt.
The strings are held in a state field reading a mutable holder rather than in a compartment,
because `blank()` builds a document from the extension list `createEditor` captured once and a
compartment's initial content would be the language the window opened in.

**A diagnostic's `range` survives the whole pipeline; an artwork's has to be caught on the way past.** The problems panel (E9.3) lists what the stages said and puts the cursor on the span each one names, which costs nothing: a `Diagnostic` carries its `range` to the end. Selecting a slide scrolls the editor to the `::directive` that made it, and that number exists only in `resolve` — a `Scene` has no source position at all, so by the time a frame exists it is three stages gone. `brief:preview` therefore answers with an `artworks` list beside `frames`, built by zipping `scene.artworks` against `resolved.artworks` by position, which `compile` guarantees is one to one. The template picker is the same shape in reverse: it rewrites the frontmatter's `template:` line as an ordinary editor edit, so the preview, the panel and the undo history all follow the path typing already takes.

**The end-to-end suite is not part of `pnpm check`.** `pnpm --filter @tyto/desktop test:desktop` launches a real Electron through Playwright and asserts what no unit can reach: the three `webPreferences` flags, by name and by consequence, and that the preload actually put the bridge on the page. It downloads a ~246 MB binary on first use, which is why it sits outside the default run, the same arrangement `packages/raster` makes for its visual suite.

**Outside `pnpm check` is not outside CI, and for a year it was both.** `desktop-e2e.yml` runs both end-to-end suites under Xvfb — on a pull request touching `apps/desktop/**`, and on every push to `main` with no filter, because the app bundles nine workspace packages and a break in one of them touches no filtered path. Until TYTO-111 no workflow ran either script: `ci.yml` runs `turbo test`, which calls `apps/desktop`'s `test` script, which points at `vitest.config.ts`, whose `include` never mentions `e2e/`. The gap was invisible in the way that matters — green everywhere, and `--passWithNoTests` on the one config that looked. `tools/repo-checks/src/github-config.test.ts` now fails if either script stops being run, or stops being run before a merge.

**There is a second one, and it is a different program.** `test:desktop` launches the app this repository has on disk, which can reach a `node_modules` with 472 packages in it; `pnpm --filter @tyto/desktop test:package` runs `electron-builder --dir` first and launches what came out, which reaches only what the `files` list in `electron-builder.yml` carried. The gap is not theoretical: `builtInTemplatesDirectory()` resolves `@tyto/templates/package.json` through `createRequire`, a bundle cannot answer a resolver, and a package built without that folder **opens no window at all** rather than opening one with no templates. `docs/git-workflow.md` has the release this protects. **It runs in the same job, not a cheaper one**, and that was the open question on TYTO-111: ~1 min 15 s once the Electron zip is cached, against a failure mode — a `files:` list that drops a workspace package — introduced by editing `apps/desktop/package.json` or `electron-builder.yml`, which is to say on a desktop PR and nowhere else. The step is guarded with `!cancelled()` so a red `test:desktop` does not hide whether the package is broken too.

## Design directives

1. The IR is the single source of truth for the artwork. If it is not in the IR, it does not exist.
2. Templates produce IR, never HTML. Both the TS path and the HTML-like path converge on `Scene`.
3. Anything that can be validated without executing code (manifest, plugin.json) is validated before execution.
4. Determinism: same brief + templates + fonts ⇒ same bytes. Fonts are bundled/pinned; never `system-ui`. `@tyto/fonts` is where bundled means something an install has (ADR 0021); a face nobody bundles is `E_EXPORT_FONT_UNRESOLVED` naming it, never a substitute.
