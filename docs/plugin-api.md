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

`pluginManifestSchema` in `@tyto/plugin-api` is that document, and it is the only reader of it. Every field is checked and every rejection carries a **field path** — `contributes.1`, `config.$schema`, `(root)` — because "the manifest is invalid" is not a sentence anybody can act on in a file they typed by hand. Every problem is reported at once, the same promise the compiler makes about a brief.

| Field         | Rule                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `name`        | lowercase letters, digits and hyphens. **It is the plugin's id** — see below                     |
| `version`     | semver, with an optional prerelease tag                                                          |
| `engine`      | a version range (`>=0.1`, `^1.2.3`, `>=0.1 \|\| ^1`), checked for shape and not for satisfaction |
| `contributes` | at least one extension point from the table below, no repeats                                    |
| `permissions` | non-empty strings, no repeats; the vocabulary stays open until the loader (E11.1)                |
| `config`      | optional `{ "$schema": "…" }`, never dereferenced by the host                                    |

Unknown keys are refused, one complaint per stray key rather than one for the object holding them.

**`name` is the id, and there is only one of them.** VS Code splits `publisher` from `name` and joins them back; nothing here needs that yet, and two names for one plugin is two things to keep in step. The host throws when a `Plugin.id` and its manifest's `name` disagree, because the id is what every extension point keys on and what a loader would name a folder under `~/.tyto/plugins/` — a listing printing one name while an error prints another is the failure that foreclosed.

**`engine` is checked for shape, not for meaning.** This package can see that `lates` is a typo; it cannot see whether the host satisfies `>=99`, because that is a semver comparison against a version only the loader knows. Rejecting the first and deferring the second is the honest split.

### The manifest is a document, not a shape

`Plugin.manifest` is typed `unknown`, and the host validates it at `activate`. A built-in that handed over an object TypeScript had approved and the schema had never seen would be a built-in with a private path into the host — the exact thing ADR 0007 rules out, in the place the temptation is strongest.

So every built-in ships a real file:

| Plugin               | File                                                       |
| -------------------- | ---------------------------------------------------------- |
| `html`               | `packages/export-html/tyto-plugin.json`                    |
| `svg`                | `packages/export-svg/tyto-plugin.json`                     |
| `built-in-templates` | `apps/cli/src/plugins/built-in-templates.tyto-plugin.json` |
| `chromium`           | `apps/cli/src/plugins/chromium.tyto-plugin.json`           |
| `fs-inbox`           | `apps/cli/src/plugins/fs-inbox.tyto-plugin.json`           |
| `fs-outbox`          | `apps/cli/src/plugins/fs-outbox.tyto-plugin.json`          |

The last four are named `<id>.tyto-plugin.json` and that is the one place a built-in differs from a third party. A plugin package puts the file at its root; those four have no package of their own — they are the composition root's wiring around `@tyto/raster`, `@tyto/io` and `@tyto/templates` — and four files cannot share one name in one folder. The document is the same document, validated by the same schema, and the day one of them gets a package the file moves to that package's root under the ordinary name.

**`contributes` is verified, not believed.** `InProcessHost.activate` watches which points a plugin registers into and throws when one was not declared. Without that, `tyto plugin list` would print a promise nothing had checked — which is how a manifest field becomes a comment.

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

### `template-pack`, and the host it belongs to

A pack contributes `{ templates, directory }`: the manifests it declares, and the folder
they were read from. Both, because a manifest says what a template declares and rendering
still has to find `template.html` and the `src=` files beside it. `directory` is optional for
a pack that is bundled rather than on a disk; the built-in one has it.

**A pack has a different lifetime from an exporter, and therefore a different host**
(ADR 0020). `activateBuiltIns` builds a host per render, because an exporter binds the bytes
of the folder it is rendering and two tasks in a `tyto watch` have different `assets/`. A
template pack has no such tie: `loadRenderContext` activates it once with the rest of the
project, and the template registry is built from the directories that host holds. Reading
every manifest again per task would make the second render slower than the first for
nothing.

The registry is built from the host's packs and not from a path passed around it, which is
the difference between an extension point and a decoration: a pack that were registered and
never read would be one nobody could tell was broken.

### `editor.command` and `editor.keymap`, in full

```ts
interface EditorCommand {
  id: string; // namespaced by convention: editor.save, preview.toggleFormat, ai.caption
  label?: string;
  run(context: { view: EditorView }): void;
  undo?(context: { view: EditorView }): void;
}

interface CommandBinding {
  key: string; // CodeMirror notation: Mod-s, Mod-Shift-z
  mac?: string; // overrides key on macOS
  command: string; // an id, never a function
}
```

`createCommandRegistry` in `@tyto/editor` is the registry both points feed, and E7 hands a
plugin the same `register` the built-ins use.

**A command that edits the document must not declare an `undo`, and the registry throws if
one does.** There is one undo stack and CodeMirror's history is most of it: text is already
undone by the history, so a second `undo` for the same change would run both and overshoot
by one edit. `undo` is for what the document does not hold — the active format, an open
panel, a preview pane. A template switch rewrites the frontmatter, so it is a document
change and declares nothing; `registry.undo` still reaches it, because `registry.undo` is
the only undo a host should bind.

**The order is kept by the text history's own depth, not by a second clock.** Running a
command that declares `undo` records `undoDepth` beside it; a later undo compares that
number with the current one to decide whether the next step belongs to the command or to
the text. Nothing counts keystrokes, so nothing can disagree with CodeMirror about how many
events a burst of typing was.

**A binding names an id, and an id nobody registered is not an error.** The key falls
through to whatever else wants it — which is what makes `Mod-s` open the browser's own save
dialog in a host that has not implemented saving yet, rather than being swallowed by a menu
item that does not exist.

**Vim mode is the same registry, reached through the engine.** `:w` and `:render` are
`Vim.defineEx` registrations that look the registry up from the view they are handed, and
the engine's own `u` and `Ctrl-r` are pointed at `registry.undo`/`registry.redo` so that vim
does not get a second, shallower undo that skips app-level commands. Both registrations are
global to `@replit/codemirror-vim` — there is one vim engine however many editors are
mounted — so neither closes over an editor, and two editors with two registries still each
get their own commands.

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

**`plugin list` is the half that exists (TYTO-35).** It prints name, version, origin and contributes, in prose or under `--json`:

```
$ tyto plugin list
html                0.4.2  built-in  exporter
svg                 1.0.2  built-in  exporter
built-in-templates  0.1.0  built-in  template-pack
chromium            0.1.0  built-in  rasterizer
fs-inbox            1.0.3  built-in  source
fs-outbox           1.0.3  built-in  sink
```

`install`, `disable` and `remove` are the loader's and are not there: a command that could only ever answer "nothing" is a promise rather than a feature.

**Listing reads manifests; it does not activate.** `activateBuiltIns` wires one render — it leaves the rasterizer out when there is nothing to raster, and never wires the queue at all — so a listing built from it would be shorter on some runs than on others, and listing would have to launch a browser to tell you a browser is installed. The command reads `BUILT_IN_MANIFESTS` and validates each through the same schema a loaded plugin's file will go through; a built-in whose manifest stopped matching is reported there rather than surfacing as a `TypeError` on the next render. It exits **2** in that case, not 1: a manifest this repository ships is its own bug, and ADR 0011 reserves the retryable code for what a caller can fix.

`origin` is the one column a manifest cannot fill in for itself — an author has no way to know whether their plugin ended up bundled or installed — so it is the host's, and `external` has no producer until the loader lands.

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
third-party exporter can register and nothing can request its kind. Widening that vocabulary
belongs with the loader (E11.1) rather than before it — until a plugin can be installed at
all, opening the list would only let a caller ask for a kind nothing can provide.
