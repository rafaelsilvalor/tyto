# Architecture

## Pipeline (it is a compiler)

```
brief.brief ──parse──▶ AST ──compile──▶ Scene ──export-html──▶ HTML ──raster──▶ PNG/JPG/WebP
                          │(manifest)      │
                       validate            └──export-svg──▶ SVG
```

Every arrow is a pure function `(input) → Result<output, Diagnostic[]>`. Stages do not know each other; `pipeline` composes them.

| Stage | Package | Input → Output |
|---|---|---|
| parse | `brief-lang` | text → `BriefAst` (frontmatter + directives + rich text) |
| resolve | `core` | `BriefAst` + `TemplateRegistry` → `ResolvedBrief` (typed slots, adjustments validated against the manifest) |
| compile | `core` | `ResolvedBrief` × template → `Scene` (one `Artwork` per slide, one `Frame` per format) |
| export | `export-html`, `export-svg` | `Scene` → string per `Frame` |
| raster | `raster` (port) | HTML → image bytes |
| deliver | `io` (port) | artifacts → fs / … |

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
  pipeline       Job: brief → artworks×formats → artifacts; local queue, cancellation, progress
  plugin-api     extension-point types, PluginHost, plugin manifest, permissions
  io             BriefSource/OutputSink ports; fs adapters (inbox/outbox); local watcher
  sources        (deferred, ADR 0011) jira/trello/notion/sheets/drive plugins
  editor         CodeMirror 6: brief and template languages, vim, diagnostics, manifest-driven autocomplete
apps/
  cli            commander: render, watch, template new|check, plugin install|list
  desktop        electron-vite: main (pipeline, plugins, credentials) / preload / renderer (editor, preview, panels)
```

Runtime boundary — **pure** (no Node/DOM): core, brief-lang, template-lang, export-*, templates, plugin-api (types). **Node**: raster, pipeline, io, sources, cli. **DOM**: editor, desktop/renderer.

Path to the cloud: same pure code; `raster` swaps to Playwright in a container, `io` swaps to HTTP + bucket, `pipeline` runs as a worker consuming a queue. No pure package changes.

## Patterns and where they live

- **Hexagonal (ports & adapters)** — ports in `core`/`plugin-api`/`io`; adapters in `raster`, `io`, `sources`. Composition only in `apps/*`.
- **Compiler pipeline** — pure stages, tested in isolation with fixtures.
- **Visitor** — `SceneVisitor<T>` in `core`; each exporter implements one. New output format = new visitor.
- **Registry** — `TemplateRegistry` and `PluginRegistry`: folder discovery, manifest read without executing code.
- **Command** — editor: every edit is a `Command { execute, undo }`; keymaps map to commands; plugins register commands.
- **Result/Diagnostic** — errors are data with `severity`, `code`, `message`, `range`; they travel to the UI and to `result.json`.
- **Typed event bus** — `desktop`: main↔renderer channel through preload with contracts in `apps/desktop/shared`.
- **Strategy** — `Rasterizer` (chromium today; other backends later) and `OutputSink`.

## Desktop processes

```
renderer (Chromium, no Node)   preload (typed bridge)   main (Node)
  CodeMirror editor        ◀──────── IPC ────────▶      pipeline, TemplateRegistry
  per-format preview                                    PluginHost (utilityProcess per plugin)
  local queue / jobs panel                              inbox watcher, safeStorage
```

Raster on desktop uses an offscreen `BrowserWindow` in main (`webContents.capturePage`); the CLI uses Playwright. Both implement `Rasterizer`.

## Design directives
1. The IR is the single source of truth for the artwork. If it is not in the IR, it does not exist.
2. Templates produce IR, never HTML. Both the TS path and the HTML-like path converge on `Scene`.
3. Anything that can be validated without executing code (manifest, plugin.json) is validated before execution.
4. Determinism: same brief + templates + fonts ⇒ same bytes. Fonts are bundled/pinned; never `system-ui`.
