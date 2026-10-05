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

| Field         | Rule                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `name`        | lowercase letters, digits and hyphens. **It is the plugin's id** — see below                                            |
| `version`     | semver, with an optional prerelease tag                                                                                 |
| `engine`      | a version range (`>=0.1`, `^1.2.3`, `>=0.1 \|\| ^1`) against `PLUGIN_API_VERSION` (ADR 0040)                            |
| `contributes` | at least one extension point from the table below, no repeats                                                           |
| `permissions` | non-empty strings, no repeats; `net:<host>` gates `host.fetch`, `credentials:<key>` gates `host.credentials` (ADR 0042) |
| `config`      | optional `{ "$schema": "…" }`, never dereferenced by the host                                                           |

Unknown keys are refused, one complaint per stray key rather than one for the object holding them.

**`name` is the id, and there is only one of them.** VS Code splits `publisher` from `name` and joins them back; nothing here needs that yet, and two names for one plugin is two things to keep in step. The host throws when a `Plugin.id` and its manifest's `name` disagree, because the id is what every extension point keys on and what a loader would name a folder under `~/.tyto/plugins/` — a listing printing one name while an error prints another is the failure that foreclosed.

**`engine` is checked twice: for shape by the schema, for meaning by the loader.** The schema sees that `lates` is a typo; `satisfiesEngine` sees that `>=99` is not this host. The version it compares with is `PLUGIN_API_VERSION` — `@tyto/plugin-api`'s own, **not the app's**, because the CLI and the desktop are versioned separately and a range must mean one thing on one machine (ADR 0040). A plugin writes `"engine": ">=0.3.9"` against the API package it imports types from.

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

| `contributes`     | Registers                                                               | Built-in                                              |
| ----------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `source` / `sink` | `BriefSource` — `pull()`, `ack()`; `OutputSink` — `push()`              | fs-inbox, fs-outbox (remote ones deferred — ADR 0011) |
| `exporter`        | one **frame** to a document + mime + extension + the kinds it produces  | html, svg                                             |
| `rasterizer`      | `Rasterizer` — `raster(html, opts): Promise<Uint8Array>`                | chromium                                              |
| `template-pack`   | folder of templates                                                     | built-in templates                                    |
| `brand-kit`       | a logo, a wordmark and a signature per brand id (ADR 0063, ADR 0066)    | —                                                     |
| `directive`       | `::ns/name` in the brief → the slot directives it stands for (ADR 0043) | —                                                     |
| `editor.command`  | `{ id, run(ctx), undo? }`                                               | core-commands                                         |
| `editor.keymap`   | binding → command id (normal and vim)                                   | default-keymap, vim                                   |
| `panel`           | a page in the desktop window, `sandbox="allow-scripts"` (ADR 0045)      | —                                                     |

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

### `directive`, in full

```ts
interface DirectiveContribution {
  id: string; // the namespace: `::demo/shout` routes to id 'demo'
  names: readonly string[]; // what `::demo/` offers, for autocomplete and resolution
  transform(directive: Directive): ExpansionResult | Promise<ExpansionResult>;
}
// ExpansionResult = Result<ExpandedDirective[], Diagnostics>
// ExpandedDirective = { name, adjustments?, body } — a slot directive, with no ranges
```

**The documented "transforms AST/ResolvedBrief" is narrower now, on purpose** (ADR 0043). A
transform is handed the directive as parsed and answers with ordinary slot directives, which
`resolve` checks against the manifest as if the author had typed them. A plugin cannot put a
value in a slot the template does not declare, skip a `min`, or reach a `ResolvedBrief`.

**Its arguments are its adjustments.** `::demo/shout {slot: titulo} Direito` hands `transform`
the `slot` adjustment parsed and ranged, and on a plugin directive the adjustments are not checked
against the manifest. They do not reach the replacement unless the plugin puts them there.

**Every position is the host's.** A replacement carries no ranges. `resolve` stamps it with the
plugin directive's range and gives the same range to any plugin diagnostic that has none, so a
timeout is underlined where the directive is. A replacement names no namespace, so expansion
never recurses.

`directiveResolverOf(() => host.registry.directives())` is the port `resolve` asks.
`directiveNamesOf` lists `ns/name` for an editor. The CLI wires the first into every task. The desktop wires both since TYTO-49: an export resolves through the run's own host, and the preview through one host holding the installed plugins, whose `directiveNamesOf` rides on `brief:preview` for the editor's list after `::`.

### `panel`, in full

```ts
interface PanelContribution {
  id: string;
  title: string;
  location?: 'left' | 'right' | 'bottom';
  entry: string; // a page inside the plugin's folder: 'panel/index.html'
}
```

The desktop serves `entry` as `tyto-plugin://<plugin>/<entry>`, confined to the plugin's folder
once links are resolved, with a CSP of its own that gives it no network (ADR 0045). The page
runs in an iframe with `sandbox="allow-scripts"` and nothing else, so it cannot read the
window's DOM, the app's `localStorage` or `window.tyto`. It opens closed, and the command bar
has a toggle for it named after its `title`.

The page talks to the host through `postMessage` alone:

```js
// ask: the same permissions as the plugin's host.fetch and host.credentials (ADR 0042)
parent.postMessage(
  { tyto: 'panel', type: 'request', id: 1, capability: 'fetch', args: [url] },
  '*',
);
// answer: { tyto: 'panel', type: 'response', id: 1, ok: true, value } | { ok: false, code, message }
// hear: { tyto: 'panel', type: 'event', event: 'document', text } on every pause in typing
```

**A panel receives the open brief's text**, with no permission asked, and the plugins screen
says so on that plugin's row. A panel's `fetch` answers with the body as text.

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

**An installed pack is searched after the built-in one, and is checked first** (ADR 0046).
Until TYTO-50 an installed pack was exactly that decoration: `loadRenderContext` held the
built-in pack alone, and every brief naming an installed template was `E_UNKNOWN_TEMPLATE`.
Now the CLI activates each installed plugin into the project's host too, and searches the
packs it registered after the built-in one, so `W_TEMPLATE_SHADOWED` names an installed
template the project or the built-in hides. `directory` is relative to the plugin's
installed folder and may not lead out of it, links included, or it is
`E_PLUGIN_PACK_DIRECTORY`. A template in it is markup (`template.html`) or a code template
drawn by the pack's `build` in the plugin's process (below); a `template.ts` in the folder, or a
code template in a pack with no `build`, is `E_PLUGIN_PACK_CODE`. Either one refuses the whole plugin, so a
render reports it as `W_PLUGIN_SKIPPED` and no task activates its other contributions. The
host reads the manifests from the folder and not from the contribution's `templates`, which a
plugin may leave empty. The desktop searches them in the same order through the same check
(`installedPacks` in `@tyto/io`), once its plugins have started: `ProjectSources.setInstalled`
reads the folders again, and the window asks `templates:list` again when `plugins:panels`
answers, which is after that. A plugin refused over its pack is kept out of the preview, the
panels and the export, and its `W_PLUGIN_SKIPPED` rides every preview's diagnostics.
`docs/plugin-authoring.md` walks one from `tyto plugin new` to a render.

**An installed code template runs in its plugin's process** (ADR 0048). `TemplatePack.build(template,
context)` is the `template-pack` point's one callable, and it is optional: a folder with a
`manifest.yaml` and no `template.html` is built by it, by manifest name, through the same
call-by-id mechanism and deadline as `exportFrame`. The host checks the frame against
`frameSchema`, and a timeout, crash, throw or refused answer is `E_PLUGIN_TEMPLATE`, naming
the plugin and the template, which costs that frame and is not fatal. The context crosses without
`measure`; the faces the manifest declares under `faces:` cross beside it, once per process,
and the guest rebuilds `measure` over them with core's `measureText`, so it stays synchronous
(ADR 0038). `report` is rebuilt there too, and what the template reported crosses back beside
the frame as `ok({ frame, reports })` — always a list — checked against the closed list of codes a
template may report, so a plugin reporting any other code is `E_PLUGIN_PROTOCOL` for that frame
(ADR 0058). A face installed on the machine is sent only under a `font:<family>` permission;
without it the template measures it as `undefined` and the load says `W_PLUGIN_FONT_WITHHELD`.
The only loader is `installedTemplateSource` in `@tyto/io`, and it only calls the proxy:
nothing imports a plugin's template in Tyto's own process. The job compiles such a template with
`compileDeferred`, and every other one with `compile`. `installedPacks` refuses them with `E_PLUGIN_PACK_CODE` unless its caller passes
`allowCode: true`, which both apps do. The desktop draws them from the plugin's utility process
for the preview, the export and the queue (`template-source.ts`), and its plugins screen says
what a `font:<family>` permission sends.

### `brand-kit`, in full

A kit is what a template draws as its brand's logo and signature, supplied by a plugin rather
than written into the template (ADR 0063). The contribution is `{ id, brands }`: `id` names the
kit, and `brands` maps a brand id — spelled as a manifest's `brand` (ADR 0052) — to
`{ logo?, wordmark?, signature? }`. A logo or a wordmark is a `MarkShape`, `{ box, d, fillRule }`,
or toned layers, `{ box, layers: [{ tone, d, fillRule }] }` with `tone` `primary` or
`secondary` (ADR 0066) — never a colour: the template decides each tone's colour where it places
the mark, and a one-shape mark is all `primary`. A mark's paths together are at most 65 536
characters, a toned mark has at most 16 layers, and a signature is at most 500 characters.

A template reads the kit of **its own** brand from `context.brand`, and never another's. A
template that names no brand, or whose brand nobody supplied, gets both fields `undefined`, and
draws its own stand-in. The composition root merges every plugin's kits with
`registry.brandKitsByBrand()` and hands the map to the job as `brandKits`. **Earlier wins**, in
registration order, as templates do across sources (ADR 0020): a brand two plugins offer is
kept by the first, and `W_BRAND_KIT_SHADOWED` names the one it hid. The brand is inside the kit
and not its id on purpose — with the brand as the id, the second plugin would be refused as
`E_PLUGIN_DUPLICATE` and withdrawn whole.

A kit is data, so an installed plugin's crosses its boundary as it is, checked against a
strict schema at activation, and it reaches an installed code template with the call, beside
its context (ADR 0048), whether or not the plugin's folder is readable (ADR 0062). Both apps
pass them: `tyto render` and `tyto watch` from each task's host, and the desktop's preview from
the window's plugins and its export and queue from each run's host, each with the merge's
warnings beside its own diagnostics.

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
  credentials(key: string): Promise<string>;    // credentials:<key> only; env in the CLI, safeStorage on desktop
  fetch(url, init?): Promise<HostFetchResponse>; // net:<host> only; redirects not followed
  log: Logger; events: TypedEmitter<HostEvents>;
}
```

**For an installed plugin every member is a message** (ADR 0041). `config` validates, in the plugin's thread, the slice of configuration the host sent at activation. `log` lines cross to the host, with a `detail` that cannot be cloned sent as its text. `events` hears the `registered` and `disposed` events of each host the plugin is activated in; `emit` stays in the plugin's thread, because a plugin announcing a registration would be speaking for the registry. `fetch` and `credentials` are requests the host answers — below.

### `host.fetch` and `host.credentials` (ADR 0042)

| Permission            | Allows                                                       |
| --------------------- | ------------------------------------------------------------ |
| `net:api.example.com` | `host.fetch` to that host, any port, `http` or `https`       |
| `net:*.example.com`   | every host below `example.com`, and not `example.com` itself |
| `net:*`               | any host                                                     |
| `credentials:<key>`   | `host.credentials('<key>')`                                  |

**Checked on the host's side, against the manifest the host validated** — never in the plugin's process — by one function, `checkedCapabilities`, which the in-process host uses too. A refusal **rejects** with a `PluginCapabilityError` whose `code` is `E_PERMISSION`, the way the platform's `fetch` rejects; a declared key with no value is `E_CREDENTIAL_MISSING`, naming where the host looked. **Redirects are not followed**: the 3xx comes back with its `location`, and the next request is checked like the first, so a declared host cannot hand the request to an undeclared one. The response crosses whole — status, headers, body as bytes — with `text()` and `json()` built on the plugin's side.

The network and the secrets are a port, `HostCapabilities`. **In the CLI a credential is an environment variable**, `TYTO_PLUGIN_<NAME>_<KEY>`, both halves upper-cased with every character that is not a letter or a digit turned into `_` — plugin `meu-pdf`'s `api.token` is `TYTO_PLUGIN_MEU_PDF_API_TOKEN` — and an empty variable is unset. **On the desktop a credential is a keychain entry and nothing else** (`CLAUDE.md`): `safeStorage`, under the account `plugin:<name>:<key>`, with no environment fallback. This version of the app has no screen to store one, so a declared key answers `E_CREDENTIAL_MISSING` and its message says so; the screen is TYTO-187 (ADR 0044). The desktop's network is Electron's `net.fetch`, with `redirect: 'manual'`, so it honours the system's proxy.

## Isolation

- Main: each plugin in a process of its own under Node's permission model: a child of the CLI's Node, or of the Node the desktop carries (ADR 0050). Typed RPC; the host is a proxy.
- Renderer: `panel` runs in an iframe with `sandbox="allow-scripts"` alone; talks to the host via a `postMessage` bridge the renderer validates and main checks (ADR 0045). The window's CSP and main's `will-frame-navigate` guard keep its frame on its own plugin's pages.
- Permissions are approved at install time; denied ⇒ the call rejects with `E_PERMISSION`.

**Built in the CLI (TYTO-48, ADR 0041, ADR 0049).** Each installed plugin's module is imported by a child process of its own — started from `dist/guest/plugin-guest.js`, one per plugin for the life of the command — and what reaches a task's host is a proxy. Built-ins stay in process.

**Built in the desktop (TYTO-48, ADR 0044).** The same port, with a second adapter: each installed, enabled plugin is started when the window opens, in a process of its own on the Node the app carries (`resources/node/`, pinned in `bundled-node.json` to the Node its Electron embeds, ADR 0050), running `out/guest/plugin-guest.js`, and never in main. The start is not awaited, so a plugin whose activation hangs costs its deadline to the first export and not to the window. Every export's host activates them after the built-ins, so an installed exporter's kind is offered by the export dialog (`export:kinds`) and rendered from it; the queue renders through the same door and stays **PNG-only by decision**, because a folder picked up unattended must not change what it produces the day somebody installs a plugin — choosing kinds per folder is TYTO-188. The loader both apps call is `startInstalledPlugins` in `@tyto/plugin-api` (`installed.ts`), which takes ports only; the CLI and the desktop differ only in what they compose.

```
host (CLI process)                               guest (plugin's process)
  connectIsolatedPlugin ◀── hello {protocol: 3, sandbox} ── runGuest
                           canary denied? else E_PLUGIN_SANDBOX
                        ── activate {config} ──▶   plugin.activate(guestHost)
                        ◀── activated {registrations: data + {$call: n}}
  tryActivate(proxy)       per task host, replayed
  exportFrame(...)      ── call {handle, args} ──▶ args checked, function run
                        ◀── result {value} ──      answer checked by the host
```

**Each side validates what it receives**, with the Zod schemas in `isolation/protocol.ts` and `isolation/points.ts`: the host every guest message and every answer, the guest every host message and a call's arguments, before the plugin's code sees them. **A contribution crosses as data, and its functions stay behind as handles**; a function is callable only if its point names it, with a schema for its arguments and one for its answer. Today that is `exporter.exportFrame` and `directive.transform` (TYTO-49), which may therefore return a `Promise`; the job and `resolve` await them. `template-pack`, `brand-kit`, `editor.command`, `editor.keymap` and `panel` cross as data. `source`, `sink` and `rasterizer` are refused by name — _not available to an isolated plugin yet_. A directive's answer schema is strict: a replacement that carries a `namespace` or a `range` is `E_PLUGIN_PROTOCOL`.

**The proxy goes through `tryActivate`**, so an isolated plugin meets every check an in-process one does. `protocol` is its own number, compared at the `hello` handshake and nowhere else; it is not the engine (ADR 0040), because a plugin never sees these messages.

**A call has a deadline** (ADR 0042). `PLUGIN_CALL_DEADLINE_MS`, 30 s — ADR 0030's capture deadline, because the frame is the unit in both. A call past it answers `E_PLUGIN_TIMEOUT`, non-fatal; the process is ended and the timeout is recorded as a crash. An activation that does not finish in the same time is refused. A plugin in `while (true) {}` costs one frame's 30 s and nothing after it.

**A crash is data.** When a plugin's process ends unasked, every call waiting on it and every call after answers `E_PLUGIN_CRASHED`, non-fatal (ADR 0025): the frames other exporters draw are still delivered. A throw from the plugin's function is `E_PLUGIN_CALL`; an answer its schema refuses is `E_PLUGIN_PROTOCOL`. The crash is written to `crashes.json`, beside `plugins.json` and never inside it, **as history and not as a refusal**: the plugin is activated again on the next run, `plugin list` shows it as `crashed` with its time, and `install`, `enable` or `remove` clears it. A separate file, because the CLIs already shipped read `plugins.json` strictly, and one new key there would make an older CLI on the same machine drop every installed plugin (ADR 0041).

**In the CLI the process is a sandbox for the disk and not for the network (ADR 0049).** It starts with `--permission` and read access to the plugin's installed folder and its bootstrap, both as real paths, and nothing else: no read outside its folder, no write anywhere, no child process, no worker, no addon. Its environment is empty (on Windows, libuv adds back its eleven required variables), so no other plugin's `TYTO_PLUGIN_*` credential reaches it. **Before the plugin's module is imported, the bootstrap tries to read a file that exists outside its grant**, the CLI's own bundle, and reports the answer in `hello`. The host refuses anything but `ERR_ACCESS_DENIED`, or no report at all, with `E_PLUGIN_SANDBOX`, which names the runtime. A worker thread and Electron's `utilityProcess` both accept the flags and do not enforce them, which is why the proof is a refused read and not a flag. A link out of the folder is refused at every load (`E_PLUGIN_LINK`), because the model follows one. **The network stays advisory** on Node 22 and 24: a plugin that imports `node:net` reaches any host, and `net:*` filters `host.fetch` only. The bootstrap still deletes the global `fetch`. On Node 25 and later, `--permission` refuses the plugin's own sockets too, and `host.fetch` is the only way out. **The desktop confines its plugins the same way** (ADR 0050): the process is a child of the Node 24.21.0 the app carries, under the same flags, and its host requires the canary.

## Lifecycle

`tyto plugin install <folder|git|npm>` → fetches → validates `tyto-plugin.json` and its `engine` → shows permissions and asks → copies to `~/.tyto/plugins/<name>/` → activated on the next run. `plugin list`, `plugin disable`, `plugin enable`, `plugin remove`. `plugin new <name>` scaffolds a template pack that installs and renders unedited (`docs/plugin-authoring.md`).

```
~/.tyto/
  plugins.json          what install approved, per plugin: enabled, permissions, source
  crashes.json          when a plugin's process last ended unasked — history, read by plugin list
  plugins/<name>/       tyto-plugin.json, dist/index.js, whatever else it ships
```

**`TYTO_HOME` moves the folder.** Both apps read it — the CLI in `apps/cli/src/environment.ts`, the desktop in `apps/desktop/src/main/plugin-list.ts` — and fall back to `~/.tyto` when it is unset or empty, so the two always list the same plugins. It is also how a test points either app at a folder of its own instead of at somebody's real one.

**The desktop shows the same list** (File ▸ _Show plugins_), read through one channel, `plugins:list`: main composes `fsPluginStore` and runs every installed folder through `checkStoredPlugin`, the renderer only draws the rows. It is read-only — install, remove and disable are the CLI's — and it opens with the notice that each plugin's process contains a crash but is not a sandbox, and that `net:` and `credentials:` filter only `host.fetch` and `host.credentials` (ADR 0041, ADR 0042). A plugin whose process ended unasked is listed as `crashed`, with the same `W_PLUGIN_CRASHED` sentence `tyto plugin list` prints, until it is enabled or installed again. The rows are read by the same `readInstalledPlugins` the loaders use.

**Three sources, fetched by the programs the person already has.** A folder is used where it is. A git URL — `git+https://…`, `git@host:…`, `git://…`, anything ending `.git` — is `git clone --depth 1`. Anything else is an npm spec — a name, `name@range`, a tarball — and is `npm pack` followed by `tar`; a spec that names a file on this disk is handed to npm as `file:<absolute path>`, because npm reads a bare `packed/x.tgz` as the GitHub shorthand `user/repo` and tries to clone it. Tyto opens no connection of its own, so git's and npm's credentials, proxy and registry configuration apply unchanged, and nothing about who fetched what reaches Tyto (ADR 0011). It is also what makes the three testable offline: `apps/cli/src/plugin-install.test.ts` clones a `file://` repository and packs a local tarball through exactly the commands a real URL and a real name take.

**Both files drop the keys they do not know rather than refusing** (ADR 0041), so a newer CLI or desktop can add a field without costing the older one its plugins. **The approval is recorded apart from the files.** A folder under `plugins/` says a plugin's files are here; it does not say anybody agreed to run them. So `plugins.json` holds what `install` asked and was told, and the loader reads both: **a folder with no entry is not installed** — one copied in by hand has had no question asked — and an entry whose plugin now declares a permission nobody approved is refused (`E_PLUGIN_PERMISSIONS_CHANGED`) until it is installed again. Installing a name that is already installed replaces it; that is how an update lands. A built-in's name is never available. **A link in the folder is copied as its target when the target is inside the folder, and refused otherwise** (`E_PLUGIN_LINK`, exit 1, naming the file): `PluginStore.add` answers a `Result`, because copying a link as a link was an `EPERM` on Windows without an administrator and reached the person as an internal failure.

**Approved is enforced where it crosses, and the prompt says how far.** An installed plugin runs in a process of its own (see Isolation), and the prompt says what confines it: its own folder, by Node's permission model, and not the network, where `net:` permissions filter `host.fetch` only. `credentials:` permissions filter `host.credentials`. `install` prints that sentence beside the list, so nobody reads a granted permission as more of a boundary than it is. Without a terminal to answer, `install` needs `--yes`.

**A plugin that cannot load does not stop a render** (ADR 0040). Installed plugins are read and imported once per process, and activated into each task's host **after** the built-ins through `InProcessHost.tryActivate`, which answers with diagnostics instead of throwing. A contribution id another plugin already holds is `E_PLUGIN_DUPLICATE`, naming both plugins; everything the loser registered is withdrawn, and the task renders without it. On a render every refusal is carried as `W_PLUGIN_SKIPPED` in `result.json` — a warning, because the brief is not what is wrong.

**`plugin list` shows built-ins and installed plugins alike**, with a status column:

```
$ tyto plugin list
html                0.4.2  built-in  enabled   exporter
svg                 1.0.2  built-in  enabled   exporter
built-in-templates  0.1.0  built-in  enabled   template-pack
chromium            0.1.0  built-in  enabled   rasterizer
fs-inbox            1.0.3  built-in  enabled   source
fs-outbox           1.0.3  built-in  enabled   sink
pdf                 1.0.0  external  disabled  exporter
```

`refused` is the third status — a folder that failed a check that reads no code, with the reason on stderr. `crashed` is the fourth, and the only one that is history: the plugin's thread ended unasked on an earlier run, stderr names when and why (`W_PLUGIN_CRASHED`), and the plugin still activates. `--active` shows only what a render would activate — so `crashed` is in it — and `--json` prints the same rows with `engine`, `permissions`, `status` and `crashed`.

**Listing reads manifests; it does not activate.** `activateBuiltIns` wires one render — it leaves the rasterizer out when there is nothing to raster, and never wires the queue at all — so a listing built from it would be shorter on some runs than on others, and listing would have to launch a browser to tell you a browser is installed. The command reads `BUILT_IN_MANIFESTS` and validates each through the same schema a loaded plugin's file will go through; a built-in whose manifest stopped matching is reported there rather than surfacing as a `TypeError` on the next render. It exits **2** in that case, not 1: a manifest this repository ships is its own bug, and ADR 0011 reserves the retryable code for what a caller can fix. The same rule covers installed plugins: `list` imports none of their code, so `--active` means _enabled and passing every check that reads no code_, and an id collision — found only by activating — is named by the render that meets it.

`origin` is the one column a manifest cannot fill in for itself — an author has no way to know whether their plugin ended up bundled or installed — so it is the host's: `built-in` for this repository's, `external` for what the loader found under `plugins/`.

### The output kinds are open

`--types` takes the four built-in kinds or any kind an installed exporter declares. `ArtifactKind` is `BuiltInKind | (string & Record<never, never>)` — open, and still autocompleting the four — and whether a kind can be produced is the exporter registry's answer, asked once before a task starts: a kind nothing produces is refused with exit 1 and the list of kinds that are available. **A document exporter names its own file**: the artifact's extension and `mime` in `result.json` are the exporter's `extension` and `mime`; only a `rasterized` exporter's come from the raster port. **An installed plugin whose rasterized exporter declares a kind no rasterizer encodes** — `gif` — is refused at activation (`E_PLUGIN_EXPORTER_KIND`, naming the plugin), so asking for that kind is the ordinary exit 1 with the reason printed above it; `runJob`'s own `TypeError` for the same case stays as a wiring check for built-ins. Whether a browser is launched is asked of the exporters too, so `--types pdf` from a document exporter launches none.

## Phase 1 vs later

Phase 1 implements `PluginHost` and routes **every built-in through it**, with no external loader. External loading (E11.1) and isolation (E11.2) come in the plugins epic. The API is validated by real use before it opens.

What Phase 1 shipped (TYTO-34): the nine contribution types, `createPluginHost`, and the two
exporters, the Chromium rasterizer and the template pack activated through it by `apps/cli`.
Three points are typed generically — `source`, `sink` and `rasterizer` — because their ports
are declared in Node packages (`@tyto/io`, `@tyto/raster`) and this one is pure (ADR 0010);
the host stores the value and only ever reads its id. A duplicate id **throws** through `activate`, because in
Phase 1 every plugin is a built-in this repository wired itself and that is a wiring bug.
The loader (E11.1) does not catch that throw: it activates through `tryActivate`, which
answers the same question as data (ADR 0040).
