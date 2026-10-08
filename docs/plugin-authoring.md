# Writing plugins

This document is read by people **and by AI agents**. Be literal. It walks one plugin from an
empty folder to a render. The contract it follows is `docs/plugin-api.md`: every field, every
extension point and every rule about isolation is specified there, and this guide links to it
rather than repeating it. Where the two disagree, `plugin-api.md` is right and this file has a
bug.

Every command below was run as written against this repository's CLI, on 2026-09-27. The
output shown is what it printed, with the Windows `\` separators turned into `/`. The first
half, from `plugin new` to `render`, is also run by `apps/cli/src/plugin-pack.test.ts` on
every check.

## What a plugin is

A folder with two files Tyto reads and whatever else it ships:

```
meu-pack/
  tyto-plugin.json    the manifest: name, version, engine, contributes, permissions
  dist/index.js       an ES module exporting activate(host)
  package.json        only so npm can pack it; Tyto does not read it
  templates/…         for a template pack: the templates it registers
```

`tyto-plugin.json` is validated before any code runs. `dist/index.js` is imported in a worker
thread of its own and never in Tyto's thread (ADR 0041). The file names are fixed. There is no
`main` field to point elsewhere.

## Start from the scaffold

```
$ tyto plugin new meu-pack
meu-pack/tyto-plugin.json
meu-pack/package.json
meu-pack/dist/index.js
meu-pack/templates/formats.yaml
meu-pack/templates/meu-pack/manifest.yaml
meu-pack/templates/meu-pack/template.html
meu-pack/templates/meu-pack/examples/meu-pack.brief
Next: run 'tyto plugin install meu-pack', then render meu-pack/templates/meu-pack/examples/meu-pack.brief.
```

It writes a **template pack** with one template, and it installs and renders unedited. `--out
<dir>` puts the folder somewhere other than the current one. It never overwrites a file. The
name has to be one the manifest accepts (lowercase letters, digits and hyphens) and one a
template accepts, because the template inside is named after the plugin. So it starts with a
letter.

The same layout, with a real template, is in `examples/plugins/tyto-plugin-example-pack/`.

## The manifest

```json
{
  "name": "meu-pack",
  "version": "0.1.0",
  "engine": ">=<plugin API version>",
  "contributes": ["template-pack"],
  "permissions": []
}
```

`<plugin API version>` is a placeholder, not something to type: the scaffold fills it in with
the plugin API version of the CLI that ran it, so the file it writes says something like
`"engine": ">=0.3.9"`. Writing a manifest by hand, put a real version there: `@tyto/plugin-api`'s
version, **not the app's** (ADR 0040). The field-by-field rules, and the error each one produces, are the table in
`docs/plugin-api.md` › _Plugin package_. `name` is the plugin's id everywhere: in `plugin list`,
in `~/.tyto/plugins/<name>/` and in every warning about it.

## `activate(host)`

```js
export function activate(host) {
  host.registerTemplatePack({ id: 'meu-pack', templates: [], directory: 'templates' });
}
```

Three things about this function that no type will tell you:

- **It registers before it returns.** Tyto calls `activate` and sends what was registered as soon
  as it returns, without awaiting it (`packages/plugin-api/src/isolation/guest.ts`). A
  registration made after an `await` inside it is never sent.
- **It is plain JavaScript with no imports from `@tyto/*`.** Those packages are private to this
  repository and not on any registry, so there are no types to import yet. The worker hands
  `activate` its `host`, and the shapes it accepts are the ones `docs/plugin-api.md` lists per
  extension point. TypeScript and a bundler are fine if `dist/index.js` is what comes out. The
  scaffold uses neither, so a first install needs no `npm install`.
- **What crosses is data.** A contribution is copied to Tyto's thread. Its functions stay behind
  as handles, and only the ones an extension point names are callable: today
  `exporter.exportFrame`, `directive.transform` and `template-pack.build`.

### A template pack's `directory`

`directory` is **relative to the plugin's installed folder, and may not leave it**. An absolute
path, a `..` that climbs out, a link that points out and a folder that is not there are refused
(ADR 0046). The folder holds one subfolder per template, exactly like a project's `templates/`,
and `docs/template-authoring.md` is how to write one. Two rules are specific to a pack:

- **Markup, or code built into `dist/`.** A template folder with a `template.html` is markup. One
  without it is a code template, and the pack must register `build` to draw it (below). A
  `template.ts` in the folder is refused, because Tyto never imports anything from it, and a pack
  with a refused template is refused as a whole.
- **`templates` can stay empty.** Tyto reads the manifests from `directory` itself, with the
  parser a project's templates go through. It does not read the list the plugin sends.

A pack brings templates and no formats. A template's format ids must be in the `formats.yaml`
of the project that renders it, which is why the scaffold ships `templates/formats.yaml` for you
to copy from.

Check a template before installing it. This reads the folder in place, without the plugin:

```
$ tyto template check meu-pack/templates/meu-pack
meu-pack/templates/meu-pack: no problems found
```

### A code template

A code template's code lives in the plugin's module, not in its folder. The pack registers a
`build`, and Tyto calls it in the plugin's own thread, once per artwork and format, with the
template's manifest name and a `TemplateContext` (ADR 0048):

```js
export function activate(host) {
  host.registerTemplatePack({ id: 'meu-codigo', templates: [], directory: 'templates', build });
}
```

`tyto plugin new meu-codigo --code` writes one in plain JavaScript that installs and renders on
the first try. A real one is usually TypeScript that imports `@tyto/core/template` and
`@tyto/template-kit` from a checkout of this repository, **bundled with every import inlined**
into `dist/index.js`. The installed folder has no `node_modules`, and a `@tyto` package left
external is a plugin that does not activate.

- **The answer is checked.** A frame the Scene IR refuses, a throw and a call that takes more
  than 30 s are each `E_PLUGIN_TEMPLATE`, naming your plugin and the template. They cost that
  frame, and the render goes on.
- **`context.measure` answers from the faces your manifest declares.** It is synchronous, as it
  is in Tyto, so the faces have to reach your thread before the call. List every face the
  template measures in its `manifest.yaml`:

  ```yaml
  faces:
    - { family: Source Sans 3, weight: 700 }
  ```

  A face left out measures as `undefined`, and your template falls back to its own guess.

- **A face installed on the person's machine needs `font:<family>`.** Faces Tyto ships are sent
  freely. A face installed on the machine, such as a licensed CircularXX, is sent only if your
  manifest's `permissions` has `font:CircularXX` and the person approved it at install. Without
  it the render warns `W_PLUGIN_FONT_WITHHELD` and your template measures that face as `undefined`.
  On a machine without the face, Tyto measures and draws the bundled substitute, which needs no
  permission.

`tyto template check` reads markup, so it has nothing to check in a code template's folder but
the manifest. Render the example brief instead.

## Install it from its folder

```
$ tyto plugin install ./meu-pack --yes
meu-pack 0.1.0 from ./meu-pack
contributes: template-pack
permissions:
  (none)
Each plugin runs in a process of its own, so a crash stops the plugin and not Tyto.
Node's permission model confines that process to the plugin's own folder: it cannot
read your other files, write anywhere, or start programs. It is not confined on the
network: net: permissions filter host.fetch only, and a plugin that opens its own
connection is not stopped. credentials: permissions filter host.credentials.
Installed meu-pack 0.1.0.
```

Without `--yes`, `install` asks `Install it? [y/N]` at a terminal and refuses when there is no
terminal to ask. A link inside the folder (a symbolic link, or a junction on Windows) is copied
as what it points to when that is inside the folder too; one that leads out, or nowhere, is
refused with `E_PLUGIN_LINK`, naming it, and nothing is installed. It **copies** the folder into `~/.tyto/plugins/meu-pack/` (or `$TYTO_HOME`), so
an edit to your folder reaches Tyto only when you install again. Installing a name that is
already installed replaces it, and that is how an update lands.

```
$ tyto plugin list --active
html                0.4.2  built-in  enabled  exporter
svg                 1.0.2  built-in  enabled  exporter
built-in-templates  0.1.0  built-in  enabled  template-pack
chromium            0.1.0  built-in  enabled  rasterizer
fs-inbox            1.0.3  built-in  enabled  source
fs-outbox           1.0.3  built-in  enabled  sink
meu-pack            0.1.0  external  enabled  template-pack
```

## Render with it

```
$ cp meu-pack/templates/formats.yaml .
$ tyto render meu-pack/templates/meu-pack/examples/meu-pack.brief --types png,svg --out out
grid-1x1-01.png
grid-1x1-01.svg
```

The CLI searches the project's `templates/`, then the built-in pack, then installed packs. A name
an earlier source has wins, and the render says which one it hid (`W_TEMPLATE_SHADOWED`). So an
installed `promo-curso` never replaces the built-in one. `tyto watch` searches the same packs.

When a plugin cannot be used, the render goes on without it and says why in `result.json` as
`W_PLUGIN_SKIPPED`. A disabled plugin is not mentioned, because disabling it was a decision:

```
$ tyto plugin disable meu-pack
Disabled meu-pack.
$ tyto render meu-pack/templates/meu-pack/examples/meu-pack.brief --types svg --out out2
meu-pack/templates/meu-pack/examples/meu-pack.brief:2:1: error E_UNKNOWN_TEMPLATE No template named 'meu-pack'. Available: agenda-semana, carrossel-lista, promo-curso.
$ tyto plugin enable meu-pack
Enabled meu-pack.
```

`tyto plugin remove meu-pack` deletes the installed copy and what was approved for it. It prints
`Removed meu-pack.`.

**The desktop app lists installed templates too**, in the same order: a chosen templates
folder, then the built-in pack, then installed packs. Its plugins start after the window opens,
so an installed template joins the Template picker a moment after the built-in ones, and a brief
already open that names it is previewed again when it does. A skipped plugin is a row in the
problems panel. The app reads what is installed when it starts, so restart it after an install.
A code template previews and exports there from the plugin's utility process, as it renders
from the CLI, and the plugins screen shows which faces a `font:` permission sends.

## Share it

`install` takes three kinds of source, and each one is fetched by a program you already have
(`docs/plugin-api.md` › _Lifecycle_):

| Source    | Example                                                 | Fetched by             |
| --------- | ------------------------------------------------------- | ---------------------- |
| a folder  | `./meu-pack`                                            | nothing; it is copied  |
| a git URL | `git+https://github.com/<you>/tyto-plugin-meu-pack.git` | `git clone --depth 1`  |
| npm       | `tyto-plugin-meu-pack`, `name@range`, or a `.tgz` file  | `npm pack`, then `tar` |

**Nothing is built after fetching.** A git repository has to contain `dist/index.js` committed.
A build output folder is usually ignored by git, so check yours. An npm package has to include
it in its `files`, and the scaffold's `package.json` does. Both routes were run against local
sources for this guide:

```
$ (cd meu-pack && npm pack)
tyto-plugin-meu-pack-0.1.0.tgz
$ tyto plugin install ./meu-pack/tyto-plugin-meu-pack-0.1.0.tgz --yes
Installed meu-pack 0.1.0.
$ tyto plugin install file:///<path>/meu-pack.git --yes
Installed meu-pack 0.1.0.
```

The first command's `npm notice` lines are not shown. The `.git` source was a bare clone of the
scaffold folder after a `git init` and a commit. This repository has published nothing to npm or
to GitHub, so a `github:` or registry install has not been run against a real plugin.

## Other extension points

A plugin can contribute more than templates. `contributes` must name every point it registers
into, or activation is refused. The shapes are in `docs/plugin-api.md`:

- `exporter` — one frame to a document. An installed exporter's kind works with `--types`.
- `directive` — `::ns/name` in a brief expands to slot directives (ADR 0043).
- `panel` — a page in the desktop window (ADR 0045).
- `editor.command`, `editor.keymap` — cross as data.
- `source`, `sink`, `rasterizer` — **refused for an installed plugin** today.

## Permissions, and what they do not do

| Permission          | Allows                                                     |
| ------------------- | ---------------------------------------------------------- |
| `net:<host>`        | `host.fetch` to that host                                  |
| `credentials:<key>` | `host.credentials('<key>')`                                |
| `font:<family>`     | a code template is sent that face's file from this machine |

`install` shows the list and asks. A permission added in a later version is refused until the
plugin is installed again (`E_PLUGIN_PERMISSIONS_CHANGED`). Wildcards and redirects are in
`docs/plugin-api.md` › _`host.fetch` and `host.credentials`_.

**In the CLI a credential is an environment variable**: `TYTO_PLUGIN_<NAME>_<KEY>`, upper-cased,
with every character that is not a letter or a digit turned into `_`. For `meu-pack`'s
`api.token` that is `TYTO_PLUGIN_MEU_PACK_API_TOKEN`. **On the desktop a credential comes from the
system keychain only**, and a person types it into the plugins screen, next to your plugin
(TYTO-187). Until they do, a declared credential answers `E_CREDENTIAL_MISSING` there.

**In the CLI your code runs confined to its own folder** (ADR 0049). It runs in a process of its
own under Node's permission model, which can read the plugin's installed folder and nothing else.
It cannot read another file on the computer, write anywhere (its own folder included), start a
program or a worker thread, or load a native addon, and its environment is empty. So everything
it needs has to be inside its folder, bundled into `dist/` or beside it: a dependency left in a
`node_modules` outside the folder is a read the runtime refuses. If it crashes, Tyto records the
crash and carries on. **The network is not confined** on the Node versions Tyto supports: `net:`
filters `host.fetch`, and code that opens its own socket is not stopped. On Node 25 and later,
that socket is refused too. The desktop runs your plugin the same way, on the Node 24 it
carries (ADR 0050). **A panel receives the text of the brief that is open**, with no permission asked, and
the desktop's plugins screen says so on that plugin's row (ADR 0045).

## When it does not load

| What you see                              | What it means                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Plugin manifest is invalid at '<path>'`  | `tyto-plugin.json` breaks a rule; the path names the field                               |
| `E_PLUGIN_ENGINE`                         | `engine` does not include this Tyto's plugin API                                         |
| `E_PLUGIN_ACTIVATE … exports no activate` | `dist/index.js` is missing or has no `activate` export                                   |
| `E_PLUGIN_PACK_DIRECTORY`                 | `directory` is absolute, leaves the plugin, or is missing                                |
| `E_PLUGIN_PACK_CODE`                      | a `template.ts` in the pack, or a code template without `build`                          |
| `E_PLUGIN_TEMPLATE`                       | at render: a code template's `build` timed out, threw or answered a frame the IR refuses |
| `W_PLUGIN_FONT_WITHHELD`                  | a code template measures a face from this machine without `font:<family>`                |
| `E_PLUGIN_LINK`                           | at install or load: a link in the folder leads out of it, or nowhere                     |
| `E_PLUGIN_SANDBOX`                        | the plugin's process could not prove it is confined to its folder, so it was not run     |
| `E_PLUGIN_DUPLICATE`                      | another plugin already registered that contribution id                                   |
| `W_TEMPLATE_SHADOWED`                     | the project or the built-in pack has a template of that name                             |

At render time the `E_` codes arrive inside `W_PLUGIN_SKIPPED`, because your plugin is not what
is wrong with the brief. `docs/diagnostic-codes.md` has every code.

## For an agent

1. `tyto plugin new <name>`, then edit `templates/<name>/` following `docs/template-authoring.md`.
2. `tyto template check <name>/templates/<name>` until it reports no problems.
3. `tyto plugin install ./<name> --yes`, and install again after every edit.
4. Copy the format ids you use into the project's `formats.yaml`, then `tyto render` the example
   brief with `--types svg`, and read `result.json`. `status: "ok"` and no `W_PLUGIN_SKIPPED`
   is done.
