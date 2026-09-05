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
  "name": "tyto-template-pack-juridico", "version": "0.1.0", "engine": ">=0.1",
  "contributes": ["template-pack"],
  "permissions": [],
  "config": { "$schema": "..." }
}
```

## Extension points
| `contributes` | Registers | Built-in |
|---|---|---|
| `source` / `sink` | `BriefSource` — `pull()`, `ack()`; `OutputSink` — `push()` | fs-inbox, fs-outbox (remote ones deferred — ADR 0011) |
| `exporter` | `SceneVisitor<string>` + mime + extension | html, svg |
| `rasterizer` | `Rasterizer` — `raster(html, opts): Promise<Uint8Array>` | chromium |
| `template-pack` | folder of templates | built-in templates |
| `directive` | `::ns/name` in the brief → transforms AST/ResolvedBrief | — |
| `editor.command` | `{ id, run(ctx), undo? }` | core-commands |
| `editor.keymap` | binding → command id (normal and vim) | default-keymap, vim |
| `panel` | UI component in the desktop renderer (sandboxed iframe) | queue, jobs, diagnostics |

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
