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

It writes a **template pack** with one template, and it installs and renders unedited.
`--out <dir>` puts the folder somewhere other than the current one. It never overwrites a file. The
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
- **A frame draws only pictures it was handed.** Use the ref `context.files.image(...)` answers
  or one the context carries, as it is. A ref you write yourself — an absolute `path`, an `id`
  that leads out of the brief's folder — is `E_PLUGIN_TEMPLATE_ASSET` and costs that frame.
- **`context.measure` answers from the faces your manifest declares.** It is synchronous, as it
  is in Tyto, so the faces have to reach your thread before the call. List every face the
  template measures in its `manifest.yaml`:

  ```yaml
  faces:
    - { family: Source Sans 3, weight: 700 }
  ```

  A face left out measures as `undefined`, and your template falls back to its own guess.

  **A code template that leaves the built-in pack declares `faces:`, and a test pins them**
  (TYTO-436). Built in, it measured in Tyto's process with every face, so its manifest never
  needed the list; installed, it measures nothing without it. Nothing else catches the drop:
  the snapshot test and `testPlugin` both run without faces. Moving `agenda-semana` without the
  list shrank a long session title to 17.16 px instead of wrapping it, and `simulados-semana`
  differed in 28 of its 28 files until the list was there. So the repository adds
  `tests/faces.test.ts`: the faces the manifest declares are every face the example brief's
  scene sets, and no other.

  ```ts
  /** Every `family weight` a text span in the value sets, wherever it sits. */
  function facesIn(value: unknown, found = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
      for (const item of value) facesIn(item, found);
    } else if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      const font = record['font'] as { family?: unknown } | undefined;
      if (record['kind'] === 'text' && typeof font?.family === 'string') {
        found.add(`${font.family} ${String(record['weight'])}`);
      }
      for (const item of Object.values(record)) facesIn(item, found);
    }
    return found;
  }

  it('declares every face the example brief sets, and no other', async () => {
    const manifest = valueOf(
      parseManifest(read('../templates/meu/manifest.yaml'), 'manifest.yaml'),
    );
    const compiled = valueOf(
      await compileTemplate({
        brief: read('../templates/meu/examples/meu.brief'),
        template: defineTemplate(manifest, build, { svg: () => undefined, image: refAt }),
        formats: valueOf(parseFormats(read('../templates/formats.yaml'), 'formats.yaml')),
        assets: { base: '(faces test)', resolve: (reference) => Promise.resolve(refAt(reference)) },
      }),
    );

    const declared = (manifest.faces ?? []).map((face) => `${face.family} ${face.weight}`);
    expect([...facesIn(compiled.scene)].sort()).toEqual(declared.sort());
  });
  ```

  `tyto-template-agenda-semana`, `tyto-template-aprovados` and `tyto-template-simulados-semana`
  each have the whole file.

- **A face installed on the person's machine needs `font:<family>`.** Faces Tyto ships are sent
  freely. A face installed on the machine, such as a licensed CircularXX, is sent only if your
  manifest's `permissions` has `font:CircularXX` and the person approved it at install. Without
  it the render warns `W_PLUGIN_FONT_WITHHELD` and your template measures that face as `undefined`.
  On a machine without the face, Tyto measures and draws the bundled substitute, which needs no
  permission.

- **A face Google Fonts serves is fetched the first time it is missing** (ADR 0120), once per
  machine, unless the person turned Google Fonts off. A face Google does not serve, such as a
  licensed CircularXX, is reported as `W_FONT_UNAVAILABLE` naming the substitute. Name the free
  families a person can use instead, any kind of template, in its `manifest.yaml`:

  ```yaml
  fonts:
    CircularXX: { alternatives: [Inter, Manrope, DM Sans] }
  ```

  The warning lists them; nothing is drawn in them unless somebody changes the template.

- **What a configuration may change is declared in the manifest's `values`** (ADR 0153,
  `docs/template-authoring.md`), and read with `numberValue`, `colorValue`, `faceValue` and
  `imageValue` from `@tyto/core/template`, each with your own constant as the fallback. In your
  plugin's thread `context.values` is absent for now, so the fallback is what draws: keep it
  equal to the manifest's default. **A manifest with `values` needs a `@tyto/core` that knows
  the key, and so does the Tyto that loads it**: an older one refuses the manifest as unknown.
  Move your `engine` range up with the dependency in the same release.

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
meu-pack/templates/meu-pack/examples/meu-pack.brief:2:1: error E_UNKNOWN_TEMPLATE No template named 'meu-pack'. Available: banner-roxo, carrossel-lista, promo-curso.
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

## Develop it in its own repository

**A worked example of everything below is
[`tyto-template-tabela`](https://github.com/rafaelsilvalor/tyto-template-tabela)** (TYTO-434),
the house's one-image table moved out of `@tyto/templates` as the code template `tabela`. It has
the aliases and the scope-only `.npmrc`, a `dist/index.js` that inlines `@tyto/house-style`, the
kit and core, the manifest's `faces` and `font:CircularXX`, the three kinds of test (the scene's
rules, both examples through `compileTemplate`, the built bundle through `testPlugin`), and the
CI that fails when the committed bundle is not what `src/` builds to. `tyto-plugin-jira` is the
same layout for a plugin that contributes no template.

**Starting a new template repository from a Claude Code session in this checkout, run
`/new-template`** (`.claude/commands/new-template.md`, TYTO-463). It asks the name, the artwork
and its formats, brand kit or neutral, and public or private; reads the contract's versions from
`tyto-template-tabela`'s current `package.json` and confirms them on GitHub Packages; creates the
repository only after the maintainer's yes, with tabela's tests, CI and scope-only `.npmrc`; and
closes with `tyto plugin install` and an example brief that renders.

A plugin in its own repository depends on the contract instead of copying it. Tyto publishes
seven packages to GitHub Packages (ADR 0149): `@tyto/plugin-api` and `@tyto/template-kit`, which
are the contract, `@tyto/house-style`, the house's tokens and shared parts (ADR 0151), and
`@tyto/core`, `@tyto/recipe`, `@tyto/brief-lang` and `@tyto/export-html`, which they import.
They are published
under the repository owner's scope, `@rafaelsilvalor/tyto-<name>`, because nobody here owns
`@tyto` on any registry. **Write an alias, and keep importing `@tyto/...`:**

```json
{
  "devDependencies": {
    "@tyto/plugin-api": "npm:@rafaelsilvalor/tyto-plugin-api@^0.7.0"
  }
}
```

and tell npm (or pnpm) where that scope lives, in the repository's `.npmrc`:

```
@rafaelsilvalor:registry=https://npm.pkg.github.com
```

GitHub asks for a token with `read:packages` to install any package from its npm registry,
public ones included. **The token goes in your user-level `~/.npmrc`, not the repository's:**
pnpm 11 expands no `${VARIABLE}` in a committed `.npmrc`'s credentials, so a line there installs
with no token and the registry answers 401. With the GitHub CLI:

```sh
gh auth refresh -s read:packages
echo '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}' >> ~/.npmrc
NODE_AUTH_TOKEN=$(gh auth token) pnpm install
```

In a GitHub Actions workflow you need no secret: the published packages are public, so the workflow's
own `GITHUB_TOKEN` with `packages: read` installs them, and `actions/setup-node` writes the
user-level file for you:

```yaml
permissions:
  contents: read
  packages: read
# ...
    env:
      NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          registry-url: https://npm.pkg.github.com
          scope: '@rafaelsilvalor'
```

**The version you install is the engine your manifest is checked against.** A host compares
`engine` with `PLUGIN_API_VERSION`, which is `@tyto/plugin-api`'s own version (ADR 0040), so a
test in your repository can ask the installed package the same question the host will:

```ts
import { PLUGIN_API_VERSION, satisfiesEngine } from '@tyto/plugin-api';
import manifest from '../tyto-plugin.json' with { type: 'json' };

expect(satisfiesEngine(manifest.engine, PLUGIN_API_VERSION)).toBe(true);
```

**A change to the isolation protocol is a minor while the contract is 0.x**, and a major from
1.0. A `^0.7.0` range does not take a minor, so such a change never reaches your plugin through
an ordinary update: you move the range, run your tests, and move `engine` with it.

### Test it without Tyto

`@tyto/plugin-api/testing` runs your plugin the way the app runs it (ADR 0150): the manifest
checked as `install` checks it, against the version you installed; your built entry activated
over the real isolation protocol and through the same `tryActivate`; the settings you hand it
resolved as the desktop resolves `settings.json`. Build first, then:

```ts
import { readFileSync } from 'node:fs';
import { testPlugin } from '@tyto/plugin-api/testing';

const manifest = readFileSync(new URL('../tyto-plugin.json', import.meta.url), 'utf8');

const harness = await testPlugin({
  manifest,
  load: () => import('../dist/index.js'),
  settings: { 'jira.site': 'https://example.atlassian.net' },
  section: { project: 'TYTO' },
  secrets: { token: 'test-token' },
  fetch: async (url) => ({
    url,
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: new TextEncoder().encode('{"issues":[]}'),
  }),
});
if (!harness.ok) throw new Error(harness.error.map((item) => item.message).join('\n'));

// The clock is what `age` and `stamp` read; fixed, a run says the same thing every day.
const clock = { now: () => new Date('2026-10-27T15:00:00Z'), offsetMinutes: () => -180 };
const run = await harness.value.runRecipe('jira.issues jql="project = TYTO"', { clock });
await harness.value.close();
```

`testPlugin` answers the diagnostics the app would refuse your plugin with — `E_PLUGIN_ENGINE`
for an engine range the installed version does not satisfy, `E_PLUGIN_ACTIVATE` for a
registration into a point `contributes` does not list or a setting whose default its own form
refuses — and the harness carries `settings.diagnostics`, where a value you wrote that the
setting refuses is a `W_SETTING_INVALID` and its default applies. A point you list and never
register into is not an error, here or in the app.

**It does not test the sandbox.** Your code runs in the test's own process, so a plugin that
reads a file outside its folder passes here and is refused by the app. And it reads no folder:
the link check and the approval `install` records are the installed copy's, which a test does
not have.

It replaces the checkout, not the bundle. The installed folder still has no `node_modules`
(_A code template_), so whatever your code imports from `@tyto/*` at run time is inlined into
`dist/index.js` as before; a package installed from the registry is inlined the same way.

### Test a template's output without Tyto

`@tyto/template-kit/testing` compiles a brief against one code template the way the app does
(ADR 0152): the real `parseBrief`, `resolve`, `compile` and HTML exporter, in the preview's
order, and answers the `Scene` and one HTML document per frame — or every diagnostic that stopped
it. You pass the formats your template renders; the kit ships no catalogue of sizes.

```ts
import { readFileSync } from 'node:fs';
import { defineTemplate, formatCatalogue, parseManifest } from '@tyto/core';
import { compileTemplate } from '@tyto/template-kit/testing';
import { build } from './template.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = parseManifest(read('./manifest.yaml'), 'manifest.yaml');
if (!manifest.ok) throw new Error(manifest.error.map((item) => item.message).join('\n'));

const result = await compileTemplate({
  brief: read('./examples/tres-colunas.brief'),
  template: defineTemplate(manifest.value, build),
  formats: formatCatalogue({ grid: { w: 1080, h: 1350, kind: 'grid' } }),
});
if (!result.ok) throw new Error(result.error.map((item) => item.message).join('\n'));
await expect(result.value.frames[0]?.html).toMatchFileSnapshot('./__snapshots__/tres-colunas.html');
```

**The snapshot is not the export, on purpose.** By default nothing is measured, so text keeps
the lines your template produced, and every face is written as a placeholder
(`tyto-test-font:Inter-700-normal`) rather than a font file. The snapshot changes when your
template does, not when a machine has another font. Pass `faces` and `font` for the measured
layout, and `values` (`{ 'title-gap': { value: 32 } }`) to compile with what a configuration
would set (ADR 0153). A markup template (`template.html`) is not covered yet, and neither is the PNG.

### Move onto a new contract when it passes

Your range keeps your tests on the contract you built against, so a release that breaks your
plugin reaches you only when you move the range. Tyto's `contract-update` workflow moves it
for you (ADR 0154): it re-adds every `@tyto/*` alias your `package.json` asks for at
`@latest`, moves your manifest's `engine` with `@tyto/plugin-api`, runs your checks on that
tree, and only when they pass opens a pull request carrying it — ranges, `engine`, lockfile
and whatever your build changed. Call it from `.github/workflows/contract.yml`:

```yaml
name: contract
on:
  schedule:
    - cron: '0 9 * * *'
  workflow_dispatch:
concurrency: { group: contract, cancel-in-progress: false }
permissions:
  contents: write
  pull-requests: write
  actions: write
  packages: read
jobs:
  newest-contract:
    uses: rafaelsilvalor/tyto/.github/workflows/contract-update.yml@main
```

Two things outside the file, once. Your CI workflow must accept `workflow_dispatch:` — a pull
request opened with the workflow's own token starts no checks, so the job starts your CI on
the branch itself. And Settings › Actions › General › "Allow GitHub Actions to create and
approve pull requests" must be on, or the run goes red at `gh pr create`.

`@latest` goes past your caret on purpose: a protocol change is a minor while the contract is
0.x, and that minor is the release you want to hear about. A red run means a new Tyto refuses
or breaks your plugin, and nothing is opened. A green run opens at most one pull request, on
the branch `tyto/contract-update`: a run against the same contract leaves it alone, and a newer
contract replaces it. Inputs, if your repository differs: `checks` (default
`typecheck build test`), `ci-workflow` (default `ci.yml`), `node-version` (default `24`).

## What a configuration sets for the brief

A plugin file's configuration (ADR 0151) sets the template's declared `values`, and under
`brief:` four things on the brief's side (TYTO-440). Each is checked against your manifest once,
when the files are read, and **the brief wins every one of them**:

```yaml
configurations:
  curto:
    brief:
      slots: # a slot's content when the brief leaves it unset
        detalhe: Vagas limitadas
        selo: ./images/selo.png # relative to the plugin file, as an image value is
      formats: [story] # what renders when the brief lists no formats
      skeleton: | # what "new from template" and the "/" menu write, whole
        ---
        template: aviso-curto
        ---
        ::titulo
          Título
      editor: # tighter than the manifest, never looser
        titulo: { max: 20 }
```

- **`slots`** sets a slot that does not repeat. Its value is checked as the brief's would be:
  an enum against its `values`, text against the manifest's `min` and `max`. A repeated slot
  takes no default: its occurrences are the brief's artworks.
- **`formats`** must name formats the manifest renders. A `--formats` flag or the Export
  dialog's ticks still win when the brief lists none.
- **`skeleton`** is a whole brief, which the desktop's New brief from template and "/" menu
  write as it is, except its `template:` line: that names what the person picked, since a named
  configuration inherits the default's skeleton. Without one, the skeleton is computed from the
  manifest, with the configured `formats` and without the slots the configuration fills.
- **`editor`** takes a `max` per slot, counted as the manifest's `max` counts: characters on a
  text slot, occurrences on a repeated one. Past it is `W_SLOT_OVER_CONFIGURED_LIMIT`, a warning
  at the brief's line; the manifest's own `max` stays the error that refuses the value. A rule
  looser than the manifest is `W_EDITOR_RULE_LOOSER` at its line in the file, and the manifest's
  limit stands.

Anything else your manifest cannot take is `W_CONFIGURATION_BRIEF_INVALID` at its line and costs
that key alone, as a value does. A named configuration starts from the entry's `default`: slots
and rules by name, formats and skeleton whole. Nothing on the brief side reaches your plugin's
process: the host resolves the brief before it calls the template, so the protocol is unchanged.

## What a configuration's brand changes

A configuration may name the brand it draws (ADR 0155), so one template is several brands' art
with no copy of it:

```yaml
configurations:
  roxo:
    alias: tabela-roxo
    brand: roxo
  azul:
    alias: tabela-azul
    brand: azul # azul's logo, signature and accent
```

The template is handed that brand's kit in `context.brand` instead of its manifest's: the
configuration's own `brand`, else its entry `default`'s, else the manifest's. A brief cannot
name a brand; an alias is how it picks one. A brand spelled against the manifest's rule is
`W_CONFIGURATION_BRAND_INVALID` and costs that key. A brand no installed kit offers is
`W_BRAND_KIT_MISSING` at its line in the CLI, and the template draws its placeholders.

**Read the accent from the kit, with your own fallback.** A kit may carry `colors.accent`; draw
it with `context.brand.colors?.accent ?? '<the colour you drew before>'` (a house template uses
`accentOf` from `@tyto/house-style`). The fallback keeps your render without a kit unchanged,
and the kit's accent wins, so switching a configuration's brand switches its colour with its
logo. Do not declare the accent as a configurable value: the brand is its only source.

## Which formats a configuration renders

A configuration may restrict its formats with `formats:` beside `brand:` (ADR 0155 decision 6):
a subset of your manifest's, which a brief cannot widen. One template can declare grid and story
for two brands while a third renders the story only:

```yaml
configurations:
  roxo:
    brand: roxo
    formats: [story] # `formats: [grid]` in a brief, or `--formats grid`, is refused
  ocre:
    brand: ocre
```

A brief that reaches the configuration and asks for another format gets `E_UNKNOWN_FORMAT`
under the name it wrote, with the restriction as what it renders and a hint naming the
configuration; a run's `--formats` and the desktop's Export dialog meet the same check, and the
dialog offers only the restriction. A brief that lists no formats renders the restriction. A
configuration without `formats:` takes its entry `default`'s, then your manifest's.

A format your manifest does not declare is `W_CONFIGURATION_FORMATS_INVALID` at its item and is
left out; a list with nothing left, or one that is not a list, is the same warning at the key,
and the configuration keeps your manifest's formats. `brief.formats` is different: it is the
default a brief starts from, and it must sit inside the restriction; a format outside it is the
same warning and is left out of the default. The restriction runs in the host before your
template is called, so the protocol is unchanged.

## Other extension points

A plugin can contribute more than templates. `contributes` must name every point it registers
into, or activation is refused. The shapes are in `docs/plugin-api.md`:

- `exporter` — one frame to a document. An installed exporter's kind works with `--types`.
- `directive` — `::ns/name` in a brief expands to slot directives (ADR 0043).
- `panel` — a page in the desktop window (ADR 0045).
- `theme` — a colour theme for the window and the editor, as a JSON file in the plugin's
  folder (ADR 0077). Data only, so an installed plugin may contribute one.
- `editor.keymap` — crosses as data, and the window reads it as a layer of its key table
  (ADR 0074).
- `editor.vim` — vim mappings onto operations the editor names (actions, operators such as
  `comment`, and the text objects `indentObject` and `entireBuffer`), and ex commands; crosses as
  data (ADR 0141, ADR 0142). The window reads it on `plugins:vim`, and the person's `vimPlugins`
  setting switches each contribution by its `id`, on unless named `false` (ADR 0143).
- `editor.command` — crosses as data, `{ id, title }`, and **nothing runs it yet**: it has no
  `run`, and the command bar does not list it. TYTO-261 makes it run; ADR 0079 says why user
  scripts wait for that.
- `source`, `sink`, `rasterizer` — **refused for an installed plugin** today.
- `configuration` — a setting in the desktop app's `settings.json` (ADR 0073). An installed
  plugin declares it as a `form`, which crosses as data (ADR 0145); a Zod schema does not.
- `recipe-verb`, `asset-source`, `font-source` — each call carries `section`: your plugin's own
  key under `plugins` in the folder's `.tyto/project.json`, merged with the work profile (ADR
  0117, ADR 0147). It is where a folder says which site or sheet it works with, and it wins
  over your settings, which are the person's and the same in every folder. **It is absent in
  a restricted folder**, and you never see another plugin's. Tyto does not check it, so answer
  your own diagnostic when it is wrong. Never put a secret there: the file is shared as text,
  and a token is a declared credential (ADR 0134). To try a value without editing the file:

  ```sh
  tyto render poster.brief --section my-plugin.site=acme.example --section my-plugin.limit=50
  ```

## Ship a theme

A colour theme is a JSON file in the plugin's folder and one call in `activate`. Nothing the
plugin wrote runs to apply it, so it needs no permission. A plugin that only ships a theme:

```text
sepia/
  tyto-plugin.json     { "name": "sepia", "version": "1.0.0", "engine": ">=0.1",
                         "contributes": ["theme"], "permissions": [] }
  package.json         { "name": "sepia", "type": "module" }
  dist/index.js
  themes/sepia.json
```

```js
// dist/index.js
export function activate(host) {
  host.registerTheme({ id: 'sepia', label: 'Sepia', kind: 'light', path: 'themes/sepia.json' });
}
```

```json
{
  "name": "Sepia",
  "kind": "light",
  "colors": { "surface": "#f4ecd8", "text": "#433422", "accent": "#9c5a2a" }
}
```

1. **Name only what you change.** The 40 names are the window's colour roles without the
   `--tyto-` prefix; `apps/desktop/src/main/themes/tyto-light.json` lists them with Tyto Light's
   values. Every name you leave out is the built-in theme of your `kind`. A name that is not a
   role is `W_THEME_TOKEN_UNKNOWN`; a value that is not a hex colour, `rgb()`, `hsl()` or a
   `color-mix()` of those is `W_THEME_COLOR_INVALID` and keeps the built-in colour.
2. **`kind` says when it shows.** The file's `kind` must match the contribution's. With the
   setting's default, `mode: "system"`, a light theme shows while the system is light.
3. **Install it** (`tyto plugin install <folder>`) and open "Preferences: Color Theme" with
   Ctrl+K. Moving through the list previews each theme; Enter writes the choice to
   `settings.json`, and Escape goes back. By hand, the setting is either one id or a theme per
   kind:

   ```jsonc
   // settings.json
   { "theme": { "mode": "system", "light": "sepia", "dark": "tyto-dark" } }
   ```

   `mode` is `system`, `light` or `dark`; the last two override the system for the window, the
   editor and the native dialogs. An id no plugin offers, or a dark theme in the `light` slot,
   is `W_SETTING_INVALID` and the default applies.

4. **When it does not look right**, open the problems panel. A file that does not parse, or is
   not shaped like a theme, is `E_THEME_INVALID` there, and the built-in theme of its kind
   applies whole: a broken theme never breaks the window.

`e2e/__fixtures__/plugins/sepia` in `apps/desktop` is this plugin, and the desktop's suite
installs it. A theme colours the window, never the exported artwork (ADR 0077).

## Permissions, and what they do not do

| Permission          | Allows                                                     |
| ------------------- | ---------------------------------------------------------- |
| `net:<host>`        | `host.fetch` to that host                                  |
| `credentials:<key>` | `host.credentials('<key>')`, and `.set` and `.delete` it   |
| `font:<family>`     | a code template is sent that face's file from this machine |
| `workspace:read`    | `host.workspace.read(path)` in the open folder             |
| `workspace:write`   | `host.workspace.write(path, bytes)`, never into `.tyto/`   |

`install` shows the list and asks. A permission added in a later version is refused until the
plugin is installed again (`E_PLUGIN_PERMISSIONS_CHANGED`). Wildcards and redirects are in
`docs/plugin-api.md` › _`host.fetch` and `host.credentials`_.

**In the CLI a credential is an environment variable**: `TYTO_PLUGIN_<NAME>_<KEY>`, upper-cased,
with every character that is not a letter or a digit turned into `_`. For `meu-pack`'s
`api.token` that is `TYTO_PLUGIN_MEU_PACK_API_TOKEN`. **On the desktop a credential comes from the
system keychain only**, and a person types it into the plugins screen, next to your plugin
(TYTO-187), or your plugin stores one itself with `host.credentials.set(key, value)` and forgets it
with `host.credentials.delete(key)` (ADR 0134); a value is at most 16 KiB. Until either happens, a
declared credential answers `E_CREDENTIAL_MISSING` there. **The CLI only reads**: `set` and
`delete` there answer `E_CREDENTIAL_READ_ONLY`, so a plugin that stores a secret should say how to
set the variable instead.

**Your plugin has a private cache and needs no permission for it** (ADR 0138):
`host.cache.put(key, bytes)` stores and answers `{ storedAt }`, `host.cache.get(key)` answers
`{ bytes, storedAt }` or `undefined`, `host.cache.list(prefix)` names what is there, and
`host.cache.delete(key)` forgets. `storedAt` is the host's clock, so it is the age to show a
person. A key is at most 1 KiB and an entry at most 32 MiB. A recipe source that caches reads
`refresh` on its `page` request: `true` when the person asked to run again without cache, and
then it fetches instead of answering from `host.cache` (ADR 0148). **A file in the person's project is
`host.workspace.read(path)` and `host.workspace.write(path, bytes)`**, relative to the open folder,
behind `workspace:read` and `workspace:write`; a restricted folder answers
`E_WORKSPACE_FILE_RESTRICTED`, and `tyto watch` has no workspace at all.

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
| `E_PLUGIN_TEMPLATE_ASSET`                 | at render: a code template's frame drew a picture it was not handed                      |
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
