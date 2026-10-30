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

| Field         | Rule                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `name`        | lowercase letters, digits and hyphens. **It is the plugin's id** — see below                                                  |
| `version`     | semver, with an optional prerelease tag                                                                                       |
| `engine`      | a version range (`>=0.1`, `^1.2.3`, `>=0.1 \|\| ^1`) against `PLUGIN_API_VERSION` (ADR 0040)                                  |
| `contributes` | at least one extension point from the table below, no repeats                                                                 |
| `permissions` | non-empty strings, no repeats; `net:<host>` gates `host.fetch`, `credentials:<key>` gates `host.credentials` (ADR 0042)       |
| `config`      | optional `{ "$schema": "…" }`, never dereferenced by the host                                                                 |
| `namespace`   | lowercase letters, digits and hyphens; required with `recipe-verb` or `recipe-derivation`, one plugin's alone (ADR 0135)      |
| `writes`      | optional; the kinds of write the plugin's recipe actions and sinks may plan, lowercase words, no repeats (ADR 0129, ADR 0135) |

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
| `desktop`            | `apps/desktop/src/main/desktop.tyto-plugin.json`           |

The last five are named `<id>.tyto-plugin.json` and that is the one place a built-in differs from a third party. A plugin package puts the file at its root; those five have no package of their own — they are the composition root's wiring around `@tyto/raster`, `@tyto/io`, `@tyto/templates` and the desktop app's own settings — and five files cannot share one name in one folder. The document is the same document, validated by the same schema, and the day one of them gets a package the file moves to that package's root under the ordinary name.

**`contributes` is verified, not believed.** `InProcessHost.activate` watches which points a plugin registers into and throws when one was not declared. Without that, `tyto plugin list` would print a promise nothing had checked — which is how a manifest field becomes a comment.

## Extension points

| `contributes`       | Registers                                                                                 | Built-in                                              |
| ------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `source` / `sink`   | `BriefSource` — `pull()`, `ack()`; `OutputSink` — `push()`                                | fs-inbox, fs-outbox (remote ones deferred — ADR 0011) |
| `exporter`          | one **frame** to a document + mime + extension + the kinds it produces                    | html, svg                                             |
| `rasterizer`        | `Rasterizer` — `raster(html, opts): Promise<Uint8Array>`                                  | chromium                                              |
| `template-pack`     | folder of templates                                                                       | built-in templates                                    |
| `brand-kit`         | a logo, a wordmark and a signature per brand id (ADR 0063, ADR 0066)                      | —                                                     |
| `directive`         | `::ns/name` in the brief → the slot directives it stands for (ADR 0043)                   | —                                                     |
| `editor.command`    | `{ id, title }`, data only: nothing runs it yet (TYTO-261, ADR 0079)                      | —                                                     |
| `editor.keymap`     | binding → command id (normal and vim)                                                     | default-keymap, vim                                   |
| `editor.vim`        | vim mappings onto operations the editor names, and ex commands (ADR 0141)                 | —                                                     |
| `panel`             | a page in the desktop window, `sandbox="allow-scripts"` (ADR 0045)                        | —                                                     |
| `configuration`     | a key of `settings.json`: `{ id, schema \| form, default, description }` (ADR 0073, 0145) | desktop (the app's settings)                          |
| `theme`             | a colour theme, a JSON file in the plugin: `{ id, label, kind, path }` (0077)             | desktop (Tyto Light, Tyto Dark)                       |
| `asset-source`      | images behind URI schemes: `{ id, schemes, fetch }`, cached (ADR 0117)                    | —                                                     |
| `font-source`       | faces of named families: `{ id, families, fetch }`, cached (ADR 0117)                     | google-fonts (ADR 0120)                               |
| `recipe-verb`       | `<namespace>.<verb>`: a paged source, a transform, an action or a sink (0135)             | — (the generic verbs are `@tyto/recipe`'s)            |
| `recipe-derivation` | `<namespace>.<name>` for `derive`: `{ id, requires, produces, derive }` (0133)            | —                                                     |

### `configuration`, in full

```ts
interface ConfigurationContribution<T> {
  id: string; // the plugin's own key: letters and digits, no dot
  schema: ZodType<T>; // validates this key alone
  default: T; // must pass `schema`, or activation is refused
  description: string;
  options?: { value: string | number | boolean | null; description: string }[]; // help only
  entries?: { schema: ZodType; unique: boolean; options?: SettingOption[] };
  members?: { key: ZodType<string>; schema: ZodType; options?: SettingOption[] };
}
```

A setting is a key of the desktop app's `settings.json`, a JSON-with-comments file the person edits by hand (ADR 0073). **The host adds the plugin id**: a third party's `fontSize` is written `demo.fontSize`, and a built-in's keys are written as declared, which is how the app's own `templatesFolder`, `queueFolder`, `queueAutoRun` and `queueKinds` keep the names every existing file uses. A third party's key written without its prefix is `W_SETTING_UNPREFIXED` and is not accepted.

**Resolved one key at a time, and never failing** (`resolveSettings`). The user file wins over the default; a value the schema refuses costs that key alone, which takes its default and is `W_SETTING_INVALID` at the value; a key nobody declared is `W_SETTING_UNKNOWN` at the key. A list setting may declare `entries` — a schema each entry is checked against alone, and whether entries must be unique — and then a refused or repeated entry is `W_SETTING_ENTRY_INVALID` at that entry and is left out while the rest apply (TYTO-301, ADR 0091). An object setting may declare `members` — a schema for a member's name and one for its value — and then an unknown name is `W_SETTING_ENTRY_INVALID` at the name and a refused value `W_SETTING_INVALID` at the value under the dotted key; either is left out while the rest apply. Every diagnostic carries the range the file reader found. The result's `config` is the record `PluginHost.config(schema)` reads, by plugin id, handed to the host with `InProcessHost.configure` — so a plugin reads its own settings with `host.config(z.object({ fontSize: z.number() }))`, every declared key present.

**What the settings tab suggests and explains is derived from the declaration** (TYTO-304, ADR 0092). `outlineOf(declared)` reads each schema once with Zod's own `z.toJSONSchema` and answers plain data — the key, its description, its type in words (`list of string`, `number from 0.75 to 2`), its default as JSON, and the values it, one list entry or one object member may take. Those values are `options`, `entries.options` and `members.options` where the plugin wrote them, each with a sentence, and otherwise an enum's values or a boolean's two from the schema, with none. `options` are help and never a rule: the schema still decides, and an option the schema refuses makes the declaration throw, as a bad default does. The desktop sends the outline to the window on `settings:outline`, which is how a plugin's setting is suggested like a built-in's.

**An installed plugin declares one with a `form` instead of a `schema`** (TYTO-254, ADR 0145). A Zod schema is code and does not cross to the plugin's process, so an isolated plugin that passes `schema` is refused by name, told to use `form`. Any plugin may use a form; a setting has exactly one of the two. In the desktop an installed plugin's `<plugin>.<key>` is suggested, checked and delivered like a built-in's once the plugin has started — the window's host and each export's host are configured from `settings.json` — and a key of an installed plugin that is not running is `W_SETTING_PLUGIN_NOT_RUNNING`, which names it.

```ts
type SettingForm =
  | {
      type: 'string' | 'number' | 'integer' | 'boolean';
      nullable?: boolean;
      enum?: (string | number | boolean | null)[]; // alone: no bounds beside it
      minimum?: number;
      maximum?: number; // number, integer
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      format?: 'uri'; // string
    }
  | { type: 'array'; items: /* one scalar form */ SettingForm; uniqueItems?: boolean };

host.registerConfiguration({
  id: 'baseUrl',
  form: { type: 'string', format: 'uri' },
  default: 'https://example.atlassian.net',
  description: 'The Jira site this plugin reads.',
});
```

The host turns the form into a Zod schema (`settingSchemaOf`) and the setting goes on exactly as one declared with a schema: the same per-key tolerance, the same ranged `W_SETTING_INVALID`, and a default the form refuses is `E_PLUGIN_ACTIVATE`. A list form checks its entries one at a time, as `entries` does. A form that names a keyword of another type, crosses its bounds or carries a `pattern` that `tyto-pattern/1` refuses (ADR 0136: flags `iu`, at most 512 characters, no unbounded matching) is the plugin's bug and refuses activation. There is no object form and no secret field: a setting is plain text in `settings.json`, and a secret is a declared credential (ADR 0134). The plugin's process receives its slice in a `configure` message whenever its host is configured, and `host.config` answers the newest; a plugin that wants to know listens to the `configured` event. **The CLI never reads `settings.json`**: there an installed plugin's settings take their defaults; values a workspace chooses belong in its `project.json` section, which rides on each source and recipe verb call (ADR 0147).

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

### `theme`, in full

```ts
interface ThemeContribution {
  id: string;
  label: string; // what a picker shows: 'Dusk'
  kind: 'light' | 'dark'; // the base theme that fills in what this one leaves out
  path: string; // a JSON file inside the plugin's folder: 'themes/dusk.json'
}
```

```jsonc
// themes/dusk.json — data only; nothing the plugin wrote runs to apply it
{
  "name": "Dusk",
  "kind": "dark",
  "colors": { "surface": "#1b1d22", "text-muted": "#9aa0ab", "syntax-keyword": "#c792ea" },
}
```

A colour is named by the window's role without the `--tyto-` prefix — the 40 colours
`apps/desktop/src/main/themes/tyto-dark.json` lists — and its value is a hex colour, `rgb()`,
`hsl()` or a `color-mix()` of those (`isThemeColor`, which also refuses anything that could
close the declaration). **A token the theme leaves out is the base theme's of its kind**; an
unknown name is `W_THEME_TOKEN_UNKNOWN`, a value that is not a colour `W_THEME_COLOR_INVALID`, and
a file that cannot be used `E_THEME_INVALID`, after which the base theme applies whole (ADR
0077). The path is refused at registration if it leaves the folder by name, and on the disk if
it leaves through a link or junction. An installed plugin may contribute one: it crosses as
data. A theme colours the window and the editor and **never** the exported artwork, whose
colours come from the template. The person picks it with "Preferences: Color Theme" or in the
`theme` setting by its `id`; `docs/plugin-authoring.md` walks through shipping one.

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
// ask: the same permissions as the plugin's host.fetch and host.credentials (ADR 0042);
// capability is 'fetch', 'credentials', 'storeCredential' [key, value] or 'deleteCredential' [key]
parent.postMessage(
  { tyto: 'panel', type: 'request', id: 1, capability: 'fetch', args: [url] },
  '*',
);
// answer: { tyto: 'panel', type: 'response', id: 1, ok: true, value } | { ok: false, code, message }
// hear: { tyto: 'panel', type: 'event', event: 'document', text } on every pause in typing
```

**A panel receives the open brief's text**, with no permission asked, and the plugins screen
says so on that plugin's row. A panel's `fetch` answers with the body as text. **A panel may store
and forget its own plugin's declared keys** (ADR 0134, extending ADR 0045), under the same check
and ceiling as the plugin's process; it still reads only what `credentials` reads, and nothing of
another plugin's.

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
`{ logo?, wordmark?, signature?, colors? }`. A logo or a wordmark is a `MarkShape`, `{ box, d, fillRule }`,
or toned layers, `{ box, layers: [{ tone, d, fillRule }] }` with `tone` `primary` or
`secondary` (ADR 0066) — never a colour: the template decides each tone's colour where it places
the mark, and a one-shape mark is all `primary`. A mark's paths together are at most 65 536
characters, a toned mark has at most 16 layers, and a signature is at most 500 characters.
`colors` holds the brand's `accent`, a hex colour, and nothing else (ADR 0155): any other key
is refused at activation, and a second colour joins by an ADR. Protocol 11 carries it; a guest
or host on 10 refuses a kit with colours, so the handshake refuses the pair first.

A template reads the kit of **its brand** from `context.brand`: the brand of the plugin file
configuration the brief reached, else its manifest's (ADR 0155), and never another's. A
template that names no brand, or whose brand nobody supplied, gets both fields `undefined`, and
draws its own stand-in. The composition root merges every plugin's kits with
`registry.brandKitsByBrand()` and hands the map to the job as `brandKits`. **Earlier wins**, in
registration order, as templates do across sources (ADR 0020): a brand two plugins offer is
kept by the first, and `W_BRAND_KIT_SHADOWED` names the one it hid. The brand is inside the kit
and not its id on purpose — with the brand as the id, the second plugin would be refused as
`E_PLUGIN_DUPLICATE` and withdrawn whole.

A kit is data, so an installed plugin's crosses its boundary as it is, checked against a
strict schema at activation, and it reaches an installed code template with the call, inside
its context (ADR 0048), as do the refs the host read from the template's own folder (ADR
0062, TYTO-478). Both apps pass them: `tyto render` and `tyto watch` from each task's host, and the desktop's preview from
the window's plugins and its export and queue from each run's host, each with the merge's
warnings beside its own diagnostics.

### `asset-source` and `font-source`, in full

```ts
registerAssetSource({
  id: 'drive',
  schemes: ['drive'], // `drive:1AbC` in a brief; two or more lowercase characters
  fetch: async (reference, { section }) => ok({ bytes, mime: 'image/png' }),
});
registerFontSource({
  id: 'drive-fonts',
  families: ['Inter'],
  fetch: async ({ family, weight, style }, { section }) => ok(outlineBytes), // .ttf or .otf
});
```

**Asked once, then read from a cache** (ADR 0117). The host asks `fetch` while `resolve`
resolves an image whose reference starts with a declared scheme, and in the job's resource
stage for a `source: 'system'` face that no workspace font folder and no installed font has.
The answer is written to `TYTO_HOME/cache/sources/<plugin>/`, named by a hash and never by
the reference, and every later render reads the file without asking. A face that arrives
after `compile` makes the job compile once more, so the line breaks are measured against it.
**A locally installed face always wins**: a font source is never asked for a face the
machine has. An entry is kept until somebody deletes it, so a file changed at its source is
not seen until then.

`section` is the plugin's own section of the folder's `.tyto/project.json` (ADR 0112), resolved
with the work profile, and absent when the folder has none or is restricted. **A restricted
folder fetches nothing**: it reads what is already cached, and a miss says to trust the
folder. **Nor does `tyto watch`** (ADR 0118): an inbox is filled unattended, so the watcher
reads what a `tyto render` of the same reference cached, and its miss says that instead. A
brief in no workspace fetches. **The window asks only on a save, an open or an export, never
while a person types**, remembers a failed fetch until it restarts, and its queue never fetches
(ADR 0119). A `tyto render --folder` delivery copies a fetched image into
`assets/` under a name taken from its reference — `test:logo` is `logo.png` — so the delivered
brief renders without the plugin. An error answer, a throw, an image over 32 MB, a face over 16 MB or a type a
document cannot embed is `E_ASSET_SOURCE_FAILED` for an image and `W_FONT_SOURCE_FAILED`
(beside `W_FONT_SUBSTITUTED`) for a face. Reach the network with `host.fetch` under
`net:<host>`.

### `recipe-verb` and `recipe-derivation`, in full

```ts
interface RecipeVerbContribution {
  id: string; // '<namespace>.<verb>', the namespace the manifest declares
  kind: 'source' | 'transform' | 'action' | 'sink';
  arguments: {
    name;
    type: 'text' | 'number' | 'date' | 'boolean';
    positional?;
    required?;
    values?;
  }[];
  page?(request: {
    arguments;
    cursor?: string;
    section?: unknown; // this plugin's project section (ADR 0147)
    refresh?: boolean; // true on a run without cache: skip your private cache (ADR 0148)
  }): Result<{ table; cursor?: string; truncated?: boolean }>;
  transform?(request: { arguments; table; section? }): Result<Table>;
  writes?: string[]; // an action's or a sink's: a subset of the manifest's 'writes'
  plan?(request: { arguments; table; section? }): Result<Plan>; // an action's or a sink's
}
interface Plan {
  target: string;
  operations: { write: string; rowKey?: string; description: string }[];
  count: number; // operations.length
}
interface RecipeDerivationContribution {
  id: string; // '<namespace>.<name>'; bare names are Tyto's
  requires: string[];
  produces: string[];
  derive(table: Table): Result<Table>;
}
```

A plugin's share of the recipe vocabulary (ADR 0128), **named in the one namespace its
manifest declares and owns** (ADR 0135): a second plugin declaring a namespace a loaded one
owns is refused whole with `E_PLUGIN_NAMESPACE_TAKEN`, and a name outside the plugin's own
namespace refuses the plugin at load. The host checks a step's arguments against `arguments`
before the plugin is called (`E_RECIPE_ARGUMENTS`), and hands over values converted to their
types. **A source answers one page per call and the host loops** (`pagedSource` in
`@tyto/recipe`), so each call fits its own 30 s deadline; no `cursor` is the last page. A table
crosses as JSON, is held to a strict schema (`E_PLUGIN_PROTOCOL`) and then to `checkTable`
(`E_RECIPE_TABLE`: a repeated column or key, a value under no column or of the wrong type).
A repeated cursor, a page reported `truncated`, or a page past a ceiling — 8 MiB or 5,000 rows
per page, 100,000 rows and 1,000 pages per table, provisional until TYTO-386 — is
`E_RECIPE_SOURCE` and never a partial table. A plugin reports its own failure as
`E_RECIPE_VERB`, and every diagnostic it returns is placed at its cell. The composition root
hands the runner `recipeRegistriesOf(registry, { sectionOf })`, which reads the contributions
per lookup.

**Every call carries the plugin's own project section** (ADR 0147): `section` on `page`,
`transform` and `plan` is the plugin's section of the folder's `.tyto/project.json`, resolved
with the work profile — the same value an `asset-source` gets. The composition root's
`sectionOf(plugin)` is asked on every call, so a folder trusted or edited between two runs is
what the next call reads, and a verb is handed its own plugin's section and never another's.
**Absent, not `{}`, when the folder has none or is restricted.** The host does not check it: it
is the plugin's data, and a plugin that finds it wrong answers its own diagnostic, which is
placed at the verb. `host.config` stays the person's settings (`settings.json` in the window,
the declared defaults in the CLI), process-wide and the same in every folder; treat the
section as what this folder chooses over them. **Never a secret**: the file is plain text a
team shares, and a token is a declared credential (ADR 0134).
`tyto render --section <plugin>.<key>=<value>` sets a key for one run over the file's, and applies in a restricted
folder too. Runnable commands (TYTO-261) will carry the same field.

**An action or a sink plans and writes nothing** (ADR 0129). It declares `writes`, the kinds of
write its plans may hold, a subset of the manifest's `writes`, or the plugin is refused at load;
a source or a transform that declares `writes` is refused too. Its `plan` is handed the table
the cell reads and answers a `Plan`, which the runner returns as the cell's `plan`; the table
passes through unchanged to the next cell. The host refuses a plan with `E_RECIPE_PLAN`, at the
verb, when an operation's `write` is one the verb did not declare, when `count` is not the
number of operations, when a `rowKey` is not a key of the table, or past 10,000 operations or a
500-character description (`PLAN_LIMITS`, provisional). **There is no `apply` in this
version**: nothing a plan describes is written. TYTO-378 adds it, and may add fields to `Plan`
but never remove or retype one, so a plan written today stays valid.
`examples/plugins/tyto-plugin-example-recipe/` contributes `example.pull`, `example.tag`,
`example.parity` and the action `example.mark`, which plans one `mark` per row.

### `editor.vim`, in full

```ts
interface EditorVimContribution {
  id: string; // what the window switches on and off
  title?: string;
  mappings: {
    keys: string; // vim notation: ys, gc, <C-a>
    context?: 'normal' | 'visual' | 'operatorPending' | 'insert'; // absent: wherever vim applies it
    operation: string; // a name @tyto/editor defines; never a function
    args?: Record<string, string | number | boolean>; // handed to the operation
  }[];
  ex?: { name: string; shortName?: string; command: string }[]; // :name runs a command id
}
```

**Data only, never a callable** (ADR 0141). A vim key runs synchronously against the document,
in the window; a plugin that contributes one runs elsewhere, so a function would be a message
across processes on every keypress. A mapping names an operation `@tyto/editor` implements and
registers with `defineVimOperation`, as an **action** (runs on its keys), an **operator**
(waits for a motion and is handed the ranges it covers) or a **text object** (answers the range
around the cursor for an operator or a visual selection, as `ip` does; ADR 0142).

**The editor's text objects are `indentObject` and `entireBuffer`** (ADR 0142), both linewise.
`indentObject` is vim-indent-object's: with `args: { inner: true }` it is `ii`, the lines at the
cursor's indent or deeper, blank lines inside kept and blank lines at the edges left out;
without, it is `ai`, which adds the line that opens the block; a count climbs one level per
step. `entireBuffer` is textobj-entire's `ae`, every line, or with `inner` its `ie`, without the
blank lines at either end. A text object is mapped in `visual` and in `operatorPending`, one
mapping each:

```ts
{ keys: 'ii', context: 'visual', operation: 'indentObject', args: { inner: true } },
{ keys: 'ii', context: 'operatorPending', operation: 'indentObject', args: { inner: true } },
```

**The editor's operator `comment` is vim-commentary's `gc`** (ADR 0143): CodeMirror's
`toggleComment`, so a line comment where the language has one and a block comment where it has
only that. The built-in `desktop` plugin maps it on `gc` with no context.

An operation that changes the document declares `isEdit: true`, so `.` repeats an action as it
does an operator; and a mapping whose keys end in `<character>` hands the key pressed there to
the operation as the `selectedCharacter` arg (ADR 0143).

**`setVimContributions(contributions, enabledIds)` switches them per window**, not per editor:
the engine keeps one keymap for every editor in the window. A contribution switched on is
mapped with `Vim.mapCommand`; switched off it is unmapped, so vim's own meaning of the key comes
back (a mapping shadows the default; it does not replace it). Calls are diffed against what is
applied, so the same answer twice changes nothing. In the desktop the enabled ids are the
`vimPlugins` setting's: every contribution, built-in or installed, unless the setting names its
`id` `false` (ADR 0143).

**A contribution that cannot be applied is left out whole**, as a non-fatal
`E_VIM_CONTRIBUTION`: an operation the editor does not have, empty keys, an action mapped while
an operator is pending, a text object mapped anywhere but `visual` and `operatorPending`, keys
of the form `i` or `a` followed by two keys or more (`in(`: vim's own `i` and `a` match first,
always), keys another enabled contribution already maps in the same context, an ex `shortName`
that is not a prefix of its `name`, or an ex name another one defines.

**An ex command, once defined, stays defined**: the engine has no way to remove one. Switched
off, it does nothing. Wiring the window to the plugins' contributions and the setting that
switches them is TYTO-418.

### `editor.command` and `editor.keymap`, in full

**A plugin's `editor.command` is a name and a title, and nothing runs it yet.** The point's
type is `{ id, title }` with no `run` (`EditorCommand` in `plugin-api`'s `contributions.ts`); an
installed plugin's crosses as data with no callable (`isolation/points.ts`); nothing in `apps/`
reads `registry.commands()`, so the command bar (Ctrl+K) does not list it and the CLI cannot
call it. Making it run, from the command bar and the CLI, with a context for `run`, is TYTO-261.
ADR 0079 records why user scripts wait for it.

The shape below is `@tyto/editor`'s registry entry, which the window's built-in commands use.
It is what a plugin's command will be handed to once TYTO-261 lands, not what a plugin
registers today.

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

`createCommandRegistry` in `@tyto/editor` is the registry the window's commands live in. A
plugin's `editor.keymap` feeds the window's keybinding table (below); a plugin's
`editor.command` does not reach the registry yet (TYTO-261).

**The desktop consumes `editor.keymap` since TYTO-207** (ADR 0074). A plugin's
`{ bindings, mode?, when? }` becomes one layer of the window's keybinding table, between the
built-in set and the person's own file: keys are written `mod+shift+s`, `when` is one of the
closed contexts `editor`, `vim.normal`, `vim.insert`, `mode.desktop`, `commandBar` and
`panel`, and `mode` stands in for a missing `when` (`normal` is `mode.desktop`, `vim` is
`vim.normal`, neither is a global key). An entry the table refuses costs only itself and is a
`W_KEYBINDING_*` diagnostic; the command bar's own key cannot be taken.

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

**Vim mode is the same registry, reached through the engine.** `:w`, `:vsplit` and `:split` are
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
  registerConfiguration<T>(setting: SettingDeclaration<T>): Disposable; // ADR 0073, 0145
  config<T>(schema: ZodType<T>): T;             // validated user config, declared settings included
  credentials(key: string): Promise<string>;    // credentials:<key> only; env in the CLI, safeStorage on desktop
  fetch(url, init?): Promise<HostFetchResponse>; // net:<host> only; redirects not followed
  cache: HostCache;                             // private, no permission; get/put/delete/list (ADR 0138)
  workspace: HostWorkspace;                     // workspace:read / workspace:write; read/write (ADR 0138)
  log: Logger; events: TypedEmitter<HostEvents>;
}
```

**For an installed plugin every member is a message** (ADR 0041). `config` validates, in the plugin's thread, the slice of configuration the host sent last — at activation, then in a `configure` message each time a host it is activated in is configured (ADR 0145). `log` lines cross to the host, with a `detail` that cannot be cloned sent as its text. `events` hears the `registered` and `disposed` events of each host the plugin is activated in; `emit` stays in the plugin's thread, because a plugin announcing a registration would be speaking for the registry. `fetch` and `credentials` are requests the host answers — below.

### `host.fetch` and `host.credentials` (ADR 0042)

| Permission            | Allows                                                       |
| --------------------- | ------------------------------------------------------------ |
| `net:api.example.com` | `host.fetch` to that host, any port, `http` or `https`       |
| `net:*.example.com`   | every host below `example.com`, and not `example.com` itself |
| `net:*`               | any host                                                     |
| `credentials:<key>`   | `host.credentials('<key>')`, `.set('<key>', v)`, `.delete`   |

**Checked on the host's side, against the manifest the host validated** — never in the plugin's process — by one function, `checkedCapabilities`, which the in-process host uses too. A refusal **rejects** with a `PluginCapabilityError` whose `code` is `E_PERMISSION`, the way the platform's `fetch` rejects; a declared key with no value is `E_CREDENTIAL_MISSING`, naming where the host looked. **Redirects are not followed**: the 3xx comes back with its `location`, and the next request is checked like the first, so a declared host cannot hand the request to an undeclared one. The response crosses whole — status, headers, body as bytes — with `text()` and `json()` built on the plugin's side.

**A plugin can store and forget its own declared keys** (ADR 0134). `host.credentials` is a function with two methods: `host.credentials(key)` reads, as it always has; `host.credentials.set(key, value)` stores and resolves to nothing; `host.credentials.delete(key)` forgets and resolves to `true` when there was a value. Both sit behind the same `credentials:<key>` permission and the same `checkedCapabilities`, so an undeclared key is `E_PERMISSION` on either side of the isolation boundary. A value is a non-empty string of at most **16 KiB in UTF-8** (`CREDENTIAL_VALUE_LIMIT_BYTES`); over it is `E_CREDENTIAL_TOO_LARGE`, and an empty one is refused as a `TypeError` — forgetting is `delete`. The writers are optional on `HostCapabilities` (`storeCredential`, `deleteCredential`): a host without them answers both with `E_CREDENTIAL_READ_ONLY`, naming where it reads from.

The network and the secrets are a port, `HostCapabilities`. **In the CLI a credential is an environment variable**, `TYTO_PLUGIN_<NAME>_<KEY>`, both halves upper-cased with every character that is not a letter or a digit turned into `_` — plugin `meu-pdf`'s `api.token` is `TYTO_PLUGIN_MEU_PDF_API_TOKEN` — and an empty variable is unset. **The CLI's credentials are read-only**: a plugin's `set` or `delete` there is `E_CREDENTIAL_READ_ONLY`, naming the variable, because the environment is the person's to set and a value written into it would vanish with the process. **On the desktop a credential is a keychain entry and nothing else** (`CLAUDE.md`): `safeStorage`, under the account `plugin:<name>:<key>`, with no environment fallback. A person stores one in the plugins screen, beside the plugin that declares it (TYTO-187), or the plugin stores one itself with `host.credentials.set`; until then a declared key answers `E_CREDENTIAL_MISSING`, and its message points to that screen. The window can set or forget only a key an installed manifest declares, within the same 16 KiB, and it never reads one back: the screen learns whether a key is set and nothing more. **The account prefix `signin:<plugin>:<id>` is reserved** for the tokens browser sign-in will keep (ADR 0131): `plugin:<name>:<key>` can never produce it, so no `credentials:<key>` reaches a sign-in token. The desktop's network is Electron's `net.fetch`, with `redirect: 'manual'`, so it honours the system's proxy.

### `host.cache` and `host.workspace` (ADR 0138)

| Permission        | Allows                                                   |
| ----------------- | -------------------------------------------------------- |
| none              | `host.cache.get`, `.put`, `.delete`, `.list`             |
| `workspace:read`  | `host.workspace.read(path)`, relative to the open folder |
| `workspace:write` | `host.workspace.write(path, bytes)`, never into `.tyto/` |

**The cache is the plugin's own**, kept by the host outside every workspace and keyed by the plugin's name and a key it chooses, so it needs no permission and works in a restricted folder. `get(key)` resolves to `{ bytes, storedAt }` or `undefined`; `put(key, bytes | string)` to `{ storedAt }`; `delete(key)` to whether there was an entry; `list(prefix = '')` to `{ key, storedAt, size }[]`. `storedAt` is ISO 8601 from the host's clock, never the plugin's. A key is a non-empty string of at most **1 KiB in UTF-8** (`PLUGIN_CACHE_KEY_LIMIT_BYTES`) and an entry at most **32 MiB** (`PLUGIN_FILE_LIMIT_BYTES`); either refused is `E_PLUGIN_CACHE`. The cache as a whole has no ceiling.

**The workspace is the folder the person opened**, read and written only through the host. `read(path)` resolves to the bytes; `write(path, bytes | string)` writes the file whole and resolves to `null`. A path is relative to the folder: an absolute one, a `..` that leaves it, a link that lands outside it, a missing file, a file over 32 MiB, no folder open, and a write into `.tyto/` — refused even in a trusted folder — are `E_WORKSPACE_FILE`; a restricted folder is `E_WORKSPACE_FILE_RESTRICTED`, whose remedy is trusting it. The folder and its trust are read on every call. `checkedCapabilities` refuses the permission, the sizes and the lexical path; the adapter confines the path again after `realpath`.

Six optional ports on `HostCapabilities` answer them: `cacheGet`, `cachePut`, `cacheDelete`, `cacheList`, `workspaceRead`, `workspaceWrite`, each taking the plugin's name first. A host without the cache ports answers `E_PLUGIN_CACHE`, without the workspace ports `E_WORKSPACE_FILE`, naming itself by `hostName`. **In the CLI `tyto render` has both and `tyto watch` the cache only** (ADR 0118). On disk an entry is `TYTO_HOME/cache/plugins/<plugin>/<sha256(key)>.bin` with a `.json` sidecar `{ key, storedAt, size, sha256 }`, both written atomically; an entry whose bytes do not match the sidecar's size or digest is a miss. **The desktop has both**, against the folder open in the window at each call.

## Isolation

- Main: each plugin in a process of its own under Node's permission model: a child of the CLI's Node, or of the Node the desktop carries (ADR 0050). Typed RPC; the host is a proxy.
- Renderer: `panel` runs in an iframe with `sandbox="allow-scripts"` alone; talks to the host via a `postMessage` bridge the renderer validates and main checks (ADR 0045). The window's CSP and main's `will-frame-navigate` guard keep its frame on its own plugin's pages.
- Permissions are approved at install time; denied ⇒ the call rejects with `E_PERMISSION`.
- Installing is the only way a plugin is trusted. A plugin a workspace folder or a profile carries is not loaded while that source is restricted, and a plugin's section of a restricted source's `project.json` is withheld from it (ADR 0111).

**Built in the CLI (TYTO-48, ADR 0041, ADR 0049).** Each installed plugin's module is imported by a child process of its own — started from `dist/guest/plugin-guest.js`, one per plugin for the life of the command — and what reaches a task's host is a proxy. Built-ins stay in process.

**Built in the desktop (TYTO-48, ADR 0044).** The same port, with a second adapter: each installed, enabled plugin is started when the window opens, in a process of its own on the Node the app carries (`resources/node/`, pinned in `bundled-node.json` to the Node its Electron embeds, ADR 0050), running `out/guest/plugin-guest.js`, and never in main. The start is not awaited, so a plugin whose activation hangs costs its deadline to the first export and not to the window. Every export's host activates them after the built-ins, so an installed exporter's kind is offered by the export dialog (`export:kinds`) and rendered from it; the queue renders through the same door and stays **PNG-only by decision**, because a folder picked up unattended must not change what it produces the day somebody installs a plugin — choosing kinds per folder is TYTO-188. The loader both apps call is `startInstalledPlugins` in `@tyto/plugin-api` (`installed.ts`), which takes ports only; the CLI and the desktop differ only in what they compose.

```
host (CLI process)                               guest (plugin's process)
  connectIsolatedPlugin ◀── hello {protocol: 9, sandbox} ── runGuest
                           canary denied? else E_PLUGIN_SANDBOX
                        ── activate {config} ──▶   plugin.activate(guestHost)
                        ◀── activated {registrations: data + {$call: n}}
  tryActivate(proxy)       per task host, replayed
  host.configure(...)   ── configure {config} ──▶ host.config answers it (last one wins)
  exportFrame(...)      ── call {handle, args} ──▶ args checked, function run
                        ◀── result {value} ──      answer checked by the host
```

**Each side validates what it receives**, with the Zod schemas in `isolation/protocol.ts` and `isolation/points.ts`: the host every guest message and every answer, the guest every host message and a call's arguments, before the plugin's code sees them. **A contribution crosses as data, and its functions stay behind as handles**; a function is callable only if its point names it, with a schema for its arguments and one for its answer. Today that is `exporter.exportFrame`, `directive.transform` (TYTO-49), `fetch` on `asset-source` and `font-source` (ADR 0117), and `page`, `transform`, `plan` and `derive` on the recipe points (ADR 0135), which may therefore return a `Promise`; the job and `resolve` await them. `template-pack`, `brand-kit`, `editor.command`, `editor.keymap`, `editor.vim`, `panel`, `theme` and `configuration` — as a form, ADR 0145 — cross as data. `source`, `sink` and `rasterizer` are refused by name — _not available to an isolated plugin yet_. A directive's answer schema is strict: a replacement that carries a `namespace` or a `range` is `E_PLUGIN_PROTOCOL`.

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

### Plugin files (ADR 0151)

A plugin file names a source to fetch, `{ git, ref }`, for one plugin or for several templates. The machine's are `TYTO_HOME/plugin-files/*.yaml`; a workspace's are `.tyto/plugin-files/*.yaml`, read only once the folder is trusted. The parser, the lock's schema and the rules for which folder wins a name are `@tyto/plugin-api`'s `plugin-files.ts`; reading the folders, running `git` and the cache are `@tyto/io`'s `plugin-files.ts`, and both folders' sync is its `syncPluginFiles` (`plugin-files-sync.ts`), which takes what only an app knows as parameters: the built-in plugins' names, how a path is shown, and who answers a permission prompt. The CLI composes it in `apps/cli/src/plugin-files.ts` (TYTO-432) and the desktop in `apps/desktop/src/main/plugin-files.ts` (TYTO-433).

```
TYTO_HOME/
  plugin-files/*.yaml, plugin-files.lock.json      the machine's files and their lock
  cache/plugin-files/<sha256(git)>/<commit>/       one copy per commit, without .git
<workspace>/.tyto/plugin-files/*.yaml, plugin-files.lock.json
```

- **`tyto plugin sync [folder]`** makes the copies match the files and the locks: it fetches a locked commit the cache lacks, resolves a source the lock lacks or whose `git` or `ref` changed, and writes the lock. **`--update`** resolves every ref again, which is the only way a moving ref such as a branch moves. A commit that is not a plugin this Tyto loads (`checkInstallable`) is `E_PLUGIN_FILE_SOURCE_REFUSED`, and the lock keeps the commit it had.
- **`tyto render` runs the same sync without `--update`**, so it reaches the network only for a copy the cache lacks and never moves a pinned ref. `tyto watch` never fetches: it loads the machine's locked copies already in the cache.
- **`tyto plugin clean [folder]`** deletes the copies that no lock it can see names — the machine's and that folder's workspace's.
- A `git` that starts with `./` or `../` is a folder relative to the plugin file's own folder, as an image path is; the lock keeps it as written. A fetch runs `git init`, `git fetch --depth 1 <git> <ref>` and a checkout of `FETCH_HEAD` with `core.autocrlf=false`, so one commit is the same bytes on every machine, and `GIT_TERMINAL_PROMPT=0` so a missing credential fails instead of waiting. When it fails, the copy the lock pins loads if it is cached, and `W_PLUGIN_FILE_FETCH` names the source either way, under the plugin file that named it: a range-less diagnostic about a source reaches the caller through `onSourceProblem` with that file (TYTO-433). A lock that cannot be read makes its folder load nothing (`E_PLUGIN_FILE_SYNTAX`): resolving instead would move every ref without a word.
- A copy loads as an installed plugin does, through `pluginStoreWithCopies`, before the plugins `install` copied and over their names (`W_PLUGIN_FILE_REPLACES_INSTALLED`). Its approval is in `plugins.json` by name, never in the lock: `sync` asks, or takes `--yes`; a plugin that asks for no permissions needs no answer; a render never asks, and skips an unapproved one with `W_PLUGIN_SKIPPED`.
- Collisions: one name twice in one folder is `E_PLUGIN_FILE_DUPLICATE` and that folder supplies it from neither; the project's entry replaces the machine's whole, with `W_PLUGIN_FILE_OVERRIDDEN`; a built-in's name is `E_PLUGIN_NAME_TAKEN`.
- **A fetched pack offers only the templates its files name** (TYTO-439): its root reaches `loadTemplateRegistry` as a `TemplateRoot` with `only`, and a `plugin:` entry, or a plugin installed with `install`, offers all of them.
- **Configurations and aliases are `@tyto/core`'s `resolveTemplateConfigurations`** (TYTO-439), pure and fed by the apps: each folder's entries (`configuredTemplates`, which leaves out a template two files name), the registry that loaded, and an image port (`@tyto/io`'s `pluginFileImages`). It answers `TemplateConfigurations`, which `resolve` and `runJob` ask first: an alias, `<template>-<configuration>` when the file writes none, selects its template and that configuration's values; the bare name selects the entry's `default`; every other configuration starts from the `default` and changes what it lists. Each value is checked once against the manifest's `values`, in the file that wrote it (`W_TEMPLATE_VALUE_UNKNOWN`, `W_TEMPLATE_VALUE_INVALID` at the value's range), so `compile` has nothing left to refuse; the caller's `CompileOptions.values` lie over them. An image path is read from the file's folder and must stay inside the workspace for a project file and inside `TYTO_HOME` for a machine file, after `realpath`. An alias that is a template's name, loaded or named by a file, is `E_TEMPLATE_ALIAS_TAKEN` at the alias, and the template keeps its name; one alias twice in one folder is `E_PLUGIN_FILE_DUPLICATE`; a project alias wins a machine one with `W_PLUGIN_FILE_OVERRIDDEN`. An entry binds to the template its `source` fetched (TYTO-462): `@tyto/io` sets each `ConfiguredTemplate`'s `plugin` from the copy that fetched it, the apps label each fetched root with its plugin (`TemplateRoot.origin`), and when the registry's `originOf` names another source for the name, the entry configures nothing and `W_PLUGIN_FILE_TEMPLATE_SHADOWED` is at the entry's name.
- **Values cross to a template in its plugin's process** (protocol 10): `TemplateCall.values` carries colours, numbers, faces and the `AssetRef` the host read an image as. The guest is the host's own bundle (`dist/guest/plugin-guest.js`), so a plugin's code is not rebuilt for it; its manifest's `engine` range still has to admit the release that carries it.
- **The desktop syncs in main** (TYTO-433): at start, when the window opens a workspace folder, and on Plugins: Sync Plugin Files and Plugins: Update Plugin Files (`plugin-files:sync`, the update moving every ref). `git` is a child process main awaits, never the renderer's. The copies run as a plugin set of their own, beside the installed plugins and never mixed into them, closed and started again when a sync changes which copies load; their packs are searched after the built-in pack and before the installed ones, and an installed plugin a copy replaces leaves the search. What a sync says is a row among the template list's failures, shown with no brief open, and `templates:changed` tells the window to list and compile again. A permission prompt is a native box, recorded in `plugins.json` by name. A restricted folder's plugin files are `W_PROJECT_PLUGIN_FILES_WITHHELD` in the trust strip's count and the problems panel.
- **The desktop resolves configurations and aliases per read of its sources** (TYTO-433): `ProjectSources` runs `resolveTemplateConfigurations` against the registry it just built, and the preview and the export resolve a brief's `template:` through it, as `tyto render` does. `templates:list` lists each alias as a row of its own, the template it reaches under the alias's name with `alias: { template, configuration }`, so the picker, the "/" menu and "New brief from template" offer it with no code of their own. A sync that only edited a file tells the window too.
- Not yet: a configuration's `brief` side (TYTO-440); in the desktop, a fetched plugin's directives, panels and themes, which the window does not wire: a fetched copy contributes its templates only.

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
