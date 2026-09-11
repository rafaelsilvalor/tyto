# Plugin API

Everything that extends Tyto is a plugin, including built-ins. Model: **VS Code**, not Vim — plugins declare permissions and run isolated, because credentials for remote systems may transit through the host.

## Plugin package

```
my-plugin/
  tyto-plugin.json
  dist/index.js         export function activate(host: PluginHost): Disposable
```

```json
{
  "name": "tyto-template-pack-juridico",
  "version": "0.1.0",
  "engine": ">=0.1",
  "contributes": ["template-pack"],
  "permissions": [],
  "config": { "$schema": "..." }
}
```

## Extension points

| `contributes`     | Registers                                                              | Built-in                                              |
| ----------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| `source` / `sink` | `BriefSource` — `pull()`, `ack()`; `OutputSink` — `push()`             | fs-inbox, fs-outbox (remote ones deferred — ADR 0011) |
| `exporter`        | one **frame** to a document + mime + extension + the kinds it produces | html, svg                                             |
| `rasterizer`      | `Rasterizer` — `raster(html, opts): Promise<Uint8Array>`               | chromium                                              |
| `template-pack`   | folder of templates                                                    | built-in templates                                    |
| `directive`       | `::ns/name` in the brief → transforms AST/ResolvedBrief                | —                                                     |
| `editor.command`  | `{ id, run(ctx), undo? }`                                              | core-commands                                         |
| `editor.keymap`   | binding → command id (normal and vim)                                  | default-keymap, vim                                   |
| `panel`           | UI component in the desktop renderer (sandboxed iframe)                | queue, jobs, diagnostics                              |

### `exporter`, in full

```ts
interface Exporter {
  id: string;
  mime: string;
  extension: string;
  kinds: readonly string[]; // 'svg'; or 'png','jpeg','webp' for html
  rasterized: boolean; // the document still has to go through a Rasterizer
  exportFrame(scene, artwork, frame, options?): Result<string, Diagnostics>;
}
```

**Per frame, not per scene, and not a `SceneVisitor`.** This row used to say
`SceneVisitor<string>`, which is not a thing a job can call: a visitor is per node, and a
whole-scene export fails as a whole — twelve frames would produce one verdict where an
author needs twelve. `runJob` walks the frames itself for exactly that reason, so the
extension point is the function it actually calls (TYTO-34).

**`rasterized` is the one thing the document does not say about itself.** An SVG _is_ the
artifact; an HTML document is not a file anybody asked for, and becomes `png`, `jpeg` or
`webp` through the `rasterizer` point. Without that flag a job would be back to asking
`kind === 'svg'`, which is the branch the extension point exists to remove.

**Resources are bound at registration, not passed per frame.** What an exporter needs for a
font or an image has a shape only that exporter knows — `HtmlResources.font` takes an
`HtmlFontFace` where `SvgResources.font` takes an `SvgFontFace` — so `htmlExporterPlugin`
and `svgExporterPlugin` close over theirs. Reconciling the two shapes is a separate question
(TYTO-62) and the extension point stays out of it.

## PluginHost (what the plugin receives)

```ts
interface PluginHost {
  registerSource(s: BriefSource): Disposable;  registerSink(...); registerExporter(...); …
  config<T>(schema: ZodType<T>): T;             // validated user config
  credentials(key: string): Promise<string>;    // only with declared permission; backed by safeStorage
  fetch: typeof fetch;                          // filtered by net:* permissions
  log: Logger; events: TypedEmitter<HostEvents>;
}
```

## Isolation

- Main: each plugin in a `utilityProcess` (Electron) / `worker_threads` (CLI). Typed RPC; the host is a proxy.
- Renderer: `panel` runs in a sandboxed iframe; talks to the host via typed `postMessage`.
- Permissions are approved at install time; denied ⇒ the call rejects with `E_PERMISSION`.

## Lifecycle

`tyto plugin install <folder|git|npm>` → validates `tyto-plugin.json` → shows permissions → copies to `~/.tyto/plugins/` → `activate` on next start. `plugin list`, `plugin disable`, `plugin remove`.

## Phase 1 vs later

Phase 1 implements `PluginHost` and routes **every built-in through it**, with no external loader. External loading, permissions and isolation come in the plugins epic. The API is validated by real use before it opens.

What Phase 1 shipped (TYTO-34): the nine contribution types, `createPluginHost`, and the two
exporters, the Chromium rasterizer and the template pack activated through it by `apps/cli`.
Three points are typed generically — `source`, `sink` and `rasterizer` — because their ports
are declared in Node packages (`@tyto/io`, `@tyto/raster`) and this one is pure (ADR 0010);
the host stores the value and only ever reads its id. A duplicate id **throws**, because in
Phase 1 every plugin is a built-in this repository wired itself and that is a wiring bug;
when a loader arrives it catches the throw and reports the plugin that lost.

Not yet: the output kinds a caller may ask for are still the four built-in ones, so a
third-party exporter can register but nothing can request its kind. Widening that vocabulary
is its own card.
