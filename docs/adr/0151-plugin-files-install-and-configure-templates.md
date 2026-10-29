# 0151 — Plugin files install and configure templates from their own repositories

Status: accepted · 2026-10-28 · TYTO-430 · builds on ADR 0007, ADR 0020, ADR 0040, ADR 0046,
ADR 0048, ADR 0049, ADR 0111, ADR 0112, ADR 0117, ADR 0127, ADR 0145, ADR 0149 and ADR 0150

## Context

E18 (TYTO-429) moves every production template out of `@tyto/templates` into a repository of
its own. On 2026-10-27 Rafael was interviewed on how the app installs and configures them. His
answers are recorded below as decided; this ADR does not reopen them. What it adds is the
mechanism they leave open.

**What exists at `origin/main` dcd17570, read in the code.**

- A plugin can already contribute a folder of templates. `TemplatePack` in
  `packages/plugin-api/src/contributions.ts` carries `directory` and an optional `build`. A markup
  template is read from that folder, and a code template is built by the pack's `build` in the
  plugin's own process (ADR 0046, ADR 0048). Nothing is imported from a template folder.
- `tyto plugin install <folder|git-url|npm-name>` (`apps/cli/src/plugin.ts`,
  `apps/cli/src/plugins/fetch.ts`) runs the person's own `git` with
  `git clone --depth 1 --quiet <url>`. It takes **no ref**: it installs whatever the default
  branch holds. It then runs `checkInstallable` against `PLUGIN_API_VERSION`, refuses a built-in's
  name (`E_PLUGIN_NAME_TAKEN`), prints the permission prompt and asks `[y/N]` unless `--yes` is
  passed, and copies the folder without `.git` into `TYTO_HOME/plugins/<name>/`. It records
  `{ enabled, permissions, source }` in `TYTO_HOME/plugins.json`. It runs no install or build
  script, so the folder must already hold `dist/index.js` (`PLUGIN_ENTRY` in
  `apps/cli/src/plugins/external.ts`). Installing again is how an update lands and how new
  permissions are approved.
- `gitUrlOf` decides git or npm from the spec's shape. `https://host/owner/repo` with no `.git`
  is handed to npm.
- `TYTO_HOME` defaults to `~/.tyto` (`apps/cli/src/environment.ts`,
  `apps/desktop/src/main/plugin-list.ts`). `TYTO_HOME/plugins/` is the installed plugins' store.
- Template sources are searched in this order: the command line's or window's templates folder,
  the workspace's `templates` folders (ADR 0112), the built-in pack, then installed packs in load
  order. An earlier source wins with `W_TEMPLATE_SHADOWED`, and a duplicate inside one root is
  `E_TEMPLATE_DUPLICATE` (ADR 0020, ADR 0046).
- A workspace folder is a source that starts restricted. "Plugins loaded from the source itself,
  without `tyto plugin install`" are runnable and do not run until the person trusts it (ADR 0111).
- A template manifest declares `slots`, `adjustments`, `formats` and `faces`. **Nothing in it
  declares a configurable value today**, so nothing can be configured from outside the template.
- The published contract is `@tyto/core`, `@tyto/recipe`, `@tyto/plugin-api` and
  `@tyto/template-kit` (`CONTRACT_PACKAGES` in `tools/repo-checks/src/publish-contract.mjs`,
  ADR 0149). `_casa` is not in it yet; making it so is TYTO-431.

## Decided on 2026-10-27 (recorded, not reopened)

- **A folder of plugin files installs and configures.** A file holds either one plugin or several
  templates. It says where to fetch each one from and how to configure it. It is the plugin's
  **loading standard**.
- **Two folders.** One is in the machine's Tyto home, the other beside the project's briefs.
  **The project's overrides the machine's.**
- **Several named configurations per template.** A configuration may carry an **alias**, a named
  variant that a brief uses as a template name (`template: tabela-roxo-compacta`). The brief does
  not know it is a variant.
- **Precedence: the template's default < the file < the brief.**
- **Only what the template declares is configurable:** fonts, font sizes, colours, spacing and
  default images. Templates grow more of these over time, **keeping their concept**, so they do
  not turn into something else.
- **The brief side of a configuration covers four things:** default slot content, default formats,
  the new brief's skeleton and editor rules.
- **Default images are paths relative to the file.**
- **Templates first.** The format leaves room for every plugin, and `settings.json` keeps the other
  plugins' settings (ADR 0145) until a later card.
- `simulados-semana-roxo`, `-ocre` and `-vinho` become one template with three configurations,
  and today's names become aliases (TYTO-441).

## Decision

### 1. A configuration changes a value, never the composition

A template may declare a value configurable when changing it leaves the same pieces in the same
order: a colour, a length (a font size, a spacing, a radius), a number, a face
(`family`, `weight`, `style`) or an image. **A configuration never chooses which pieces appear or
in what order.** "Hide the logo", "two columns instead of one" and "put the date first" are
composition. A template that needs them is either a second template or a brief-side choice: an
`adjustment` or a slot, which the brief owns. This rule decides what "keeping their concept"
means in a review. A new configurable value that changes the composition is refused on the
template's side, and the same rule applies to any change that would remove a piece.

The declaration lives in the template's manifest, read with the rest of it and never run, as
`faces` is (ADR 0048). Its shape is TYTO-438. Values cross to a code template's `build` as data
with the call, like the context and the faces. A configured face that a code template measures
crosses as a declared face does, so `measure` stays synchronous. An image value is resolved by
the host into an `AssetRef` before the call. The plugin's process never reads the file, because
it may only read its own folder (ADR 0049).

### 2. The file is YAML, one plugin or several templates

**Where.** The machine's folder is `TYTO_HOME/plugin-files/`. The project's folder is
`.tyto/plugin-files/` in the workspace folder (ADR 0112). Every `*.yaml` file in either folder is
read. Not `TYTO_HOME/plugins/`, which is already the installed plugins' store.

**Format.** YAML, as template manifests are. A file has `version: 1` and exactly one of
`plugin` or `templates`. It is tolerant per key and per entry, as `project.json` is (ADR 0112):
a refused entry costs that entry alone with a diagnostic at its range, an unknown key is a
warning, and a file that does not parse loads nothing and is an error naming it.

- **`plugin:`** holds one plugin of any kind: a `source`, and nothing else in v1. Its settings
  stay in `settings.json` (ADR 0145) until a later card moves them here.
- **`templates:`** holds several templates, keyed by the name the template's manifest declares.
  Each has a `source` and optional `configurations`. **Only the templates a file names load**: a
  fetched pack that holds five templates and is named for two offers two.

A `source` is `{ git, ref }`. `git` is anything the person's `git` accepts, including `file://`
and a local path. It is written explicitly as `git` because `gitUrlOf` would send
`https://host/owner/repo` to npm. `ref` is required: a tag, a branch or a full commit hash.
Templates whose sources are equal share one fetch.

A configuration has optional `alias`, `values` and `brief`:

- `values` sets the values the template declared (decision 1). A name the template did not
  declare, or a value of the wrong kind, is a warning on that value. It falls back to the
  template's default.
- An image path is relative to **the file's folder**. Nothing is decoded. After `realpath` it must
  stay inside the workspace folder for a project file and inside `TYTO_HOME` for a machine file.
- `brief` holds the four brief-side defaults: `slots`, `formats`, `skeleton` and `editor`. Their
  shapes are TYTO-440.
- A template entry may name one of its configurations as `default`. That configuration applies
  when a brief names the template itself. Without `default`, the bare name renders with the
  template's own defaults. Every configuration is also reached by its alias. **When `alias` is
  absent, the alias is `<template>-<configuration>`**, which is how `simulados-semana-roxo` keeps
  its name with no `alias` line. An alias follows the manifest's `TEMPLATE_NAME` rule.

**Precedence, value by value:** the template's default, then the configuration the brief reached
(the entry's `default` for the bare name, or the one its alias names), then the brief. Where the brief states the same thing, such
as a slot's content or its formats, the brief wins. A project file's entry for a template
replaces the machine file's entry for that template whole: the two are not merged.

One full example, a project's `.tyto/plugin-files/tabelas.yaml`. Its first entry is E18's pilot
(TYTO-434), as Rafael decided it on 2026-10-28: the template `tabela`, from the public repository
`tyto-template-tabela`, with a configuration `roxo` whose alias is `tabela-roxo` and which is the
template's default.

```yaml
version: 1
templates:
  tabela:
    source:
      git: https://github.com/rafaelsilvalor/tyto-template-tabela.git
      ref: v1.0.0
    default: roxo # `template: tabela` renders as `roxo`
    configurations:
      roxo:
        alias: tabela-roxo # what briefs already write today
        values:
          background: '#4b2a7b'
          logo: ./images/logo-light.png
  simulados-semana:
    source:
      git: https://git.example.com/templates/tyto-template-simulados-semana.git
      ref: 9c1e5f0a7d3b2c4e6f8a0b1c2d3e4f5a6b7c8d9e
    configurations:
      roxo:
        # no alias: briefs write `template: simulados-semana-roxo`
        values:
          background: '#4b2a7b'
          title-size: 64px
      compacta:
        alias: simulados-compacto
        values:
          background: '#1f1f1f'
          row-spacing: 8px
          title-face: { family: Source Sans 3, weight: 700 }
        brief:
          formats: [story]
          slots:
            footer: Inscrições abertas
```

A file that holds one plugin:

```yaml
version: 1
plugin:
  source:
    git: https://git.example.com/plugins/tyto-plugin-example.git
    ref: v0.3.0
```

### 3. Fetching: a ref, a lock and a cache keyed by commit

- **The copy.** A source is fetched with the person's `git`, as `tyto plugin install` does. The
  command is `git init`, then `git fetch --depth 1 <git> <ref>`, then a checkout of `FETCH_HEAD`.
  Unlike `git clone --branch`, this takes a commit hash as well as a tag or a branch. It lands
  in `TYTO_HOME/cache/plugin-files/<sha256(git)>/<commit>/` without `.git`, written beside its
  name and renamed into place (ADR 0117 point 4). Copies are keyed by commit, so two projects on
  two commits of one repository each keep their own, and one copy serves every folder that locks
  the same commit.
- **The lock.** `plugin-files.lock.json` sits in the same folder as the files. It records each
  source's `git`, `ref`, the full `commit` it resolved to and the plugin's name. The tool writes it and nobody edits it by hand. A project's lock
  belongs in the project's version control, so everyone who opens the folder renders the same
  commit.
- **When.** **A sync makes the copies match the files and the lock.** It fetches a copy the lock
  names and the cache lacks. It resolves a source that has no lock entry, or whose `git` or
  `ref` changed in the file, and writes the lock. It runs when the desktop starts, when the window
  opens a workspace folder, before each CLI command that loads templates, and on an explicit
  command. **A ref that moves upstream, such as a branch, moves the lock only on the explicit
  update command**, which re-resolves every ref. A start never does, so a render does not change
  because somebody pushed. This is ADR 0117's price of determinism. `tyto watch` never fetches.
  It reads the copies that exist, as it reads the source cache (ADR 0118). The command names are
  the CLI's (TYTO-432) and the desktop's (TYTO-433).
- **An update is checked before the lock moves.** A commit whose manifest fails `checkInstallable`
  or ADR 0046's pack checks is reported. The lock keeps the commit it had.
- **A template removed from the files stops loading at once.** Its copy stays in the cache. A
  cleanup command deletes the copies that no lock it can see names: the machine's lock and the
  lock of the folder it is given or the window has open. A copy deleted too eagerly is fetched
  again by the next sync.
- **Tyto runs no install or build script of a fetched repository**, as today. A repository
  therefore commits its built `dist/` at every ref it means to be fetched. The usual way is a
  release tag its own CI builds. A code template bundles what it imports (ADR 0048), so the
  fetched folder needs no `node_modules`.

### 4. Offline: the last fetched copy, and the failure said

When a fetch fails, a source whose locked commit is in the cache loads from that copy. The failure
is reported as a warning naming the source, the ref and git's first line of error (ADR 0117
point 7, ADR 0119). A source that was never fetched loads nothing. A brief that names one of its
templates gets `E_UNKNOWN_TEMPLATE` beside the diagnostic naming the source. **Never a silent
substitution**: Tyto never falls back to another commit, the built-in pack or a template of the
same name from a source the files did not name. The window remembers the failure until the next
explicit sync or restart, as ADR 0119 does for sources.

### 5. Auth: the machine's git, nothing stored

The network is `git`'s, with the person's own configuration, credential helper, SSH keys and
proxy, as `fetch.ts` already does. **Tyto stores no credential, asks for none and names no
provider** (ADR 0011, ADR 0127). A private repository works when the person's `git` can read it.
Since a sync runs unattended, it runs `git` with `GIT_TERMINAL_PROMPT=0`. Without that, a missing
credential would wait on a prompt nobody sees instead of failing. This is new: `tyto plugin
install` runs at a terminal and sets nothing.

### 6. Loading: a fetched copy is an installed plugin

A fetched copy is a plugin folder (`tyto-plugin.json`, `dist/index.js`) and is loaded as one. It
goes through `checkInstallable` against `PLUGIN_API_VERSION` on every load (ADR 0040), ADR 0046's
pack checks, its own process under ADR 0049's confinement, the 30 s deadline and crash handling
(ADR 0042), and `W_PLUGIN_SKIPPED` when it is refused. It contributes a `TemplatePack` like any
installed plugin. **No new extension point, and no in-process path.** What differs from
`tyto plugin install` is only where the folder is (the cache) and where its enablement comes
from (the files).

- **Approval.** The first load of a plugin whose manifest asks for permissions shows the same
  prompt `tyto plugin install` prints: `--yes` or a terminal in the CLI, a dialog in the window.
  The approved set is recorded in `TYTO_HOME/plugins.json`, by plugin name, and **never in the
  lock**: a project's lock travels with the project, and an approval read from inside a source
  would let the source approve itself (ADR 0111). A later commit that asks for the same permissions or
  fewer loads without asking. One that asks for more asks again, which is what reinstalling does
  today. A plugin that asks for no permissions loads without a prompt.
- **Trust.** A project's plugin files are content its source ships that runs, the row ADR 0111
  already has: "Plugins loaded from the source itself". **In a restricted folder they are neither
  fetched nor loaded.** The strip names them with Trust this folder. The machine's files are
  trusted by where they live, as a profile in `TYTO_HOME` is (ADR 0114).

### 7. Collisions are deterministic, reported, never silent

The template search order becomes: the command line's or window's templates folder, the
workspace's `templates` folders, the built-in pack, the project's plugin files, the machine's
plugin files, then plugins installed with `tyto plugin install` in load order. ADR 0020's and
ADR 0046's rules apply as written:

| Collision                                                                    | Answer                                                                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A template, plugin or alias named in a project file and in a machine file    | The project's wins, and a warning names both files                                        |
| One name twice in one folder's files (two files, or a template and an alias) | Error; that folder supplies the name from neither file, because no order was chosen there |
| An alias equal to a real template's name, from any source                    | Error on the alias; the alias does not load and the template stands                       |
| A fetched template against a folder template or the built-in pack            | The earlier source wins, `W_TEMPLATE_SHADOWED` (ADR 0020, ADR 0046)                       |
| A fetched plugin named like a built-in                                       | `E_PLUGIN_NAME_TAKEN`, as `tyto plugin install` answers                                   |
| A fetched plugin named like one installed with `tyto plugin install`         | The file's wins and the installed copy is not activated; a warning names both             |

**An alias may never shadow a template.** If it could, a brief that names `tabela-roxo` would
render differently depending on whether a configuration somewhere happened to be called that.
The codes are named by the cards that implement them and listed in
`docs/diagnostic-codes.md` there.

### 8. `_casa` becomes its own package, `@tyto/house-style`, depended on by version

Today `_casa` is a folder inside `@tyto/templates` (`packages/templates/templates/_casa/`): the
house's brand tokens, presets and shared parts (`brands.ts`, `presets.ts`, `table.ts`,
`seal.ts`, `banner.ts` and others), imported by relative path from the production templates.
**It moves to a workspace package of its own, `packages/house-style`, named `@tyto/house-style`,
and is not a subpath of `@tyto/template-kit`.** Two reasons, read in the code:

- `@tyto/template-kit`'s own index says brand tokens do not belong in the kit: a kit that
  shipped one "would be deciding somebody else's brand" (ADR 0047).
- A version moves for the whole package. With the house's tokens inside the kit, a colour tweak
  would bump the dependency of every template that uses only the kit, including a third party's
  with no relation to the house.

**The name is `house-style`** because that is what the folder holds, in plain English: one
publisher's look (tokens, presets and the parts drawn in it), the same thing a "house style"
is in print. It is not a brand's name, which would date the moment a second brand joins.

TYTO-431 creates the package, keeps it pure like the kit (no Node or DOM import, enforced by the
same lint rule), and adds it to `CONTRACT_PACKAGES` after `@tyto/template-kit` and `@tyto/core`,
which it imports. ADR 0149 then publishes it as `@rafaelsilvalor/tyto-house-style`. A template
repository depends on it, and on `@tyto/template-kit`, through the alias form ADR 0149 gives:
`"@tyto/house-style": "npm:@rafaelsilvalor/tyto-house-style@^x.y.z"`. It bundles both into its
`dist/` and tests with `@tyto/plugin-api/testing` (ADR 0150). The template test helper,
`@tyto/template-kit/testing`, is TYTO-447 and ADR 0152.

### 9. A repository ships without a pull request here

**A template or plugin repository is created, tested and released with no pull request in the
Tyto repository.** That is the point of E18. The repository depends on the published contract
(ADR 0149), tests itself with the published harness (ADR 0150), tags a release with its built
`dist/`, and a plugin file names that tag. Tyto changes only when the contract does. The
production templates' names, colours and images live in their own repositories and in the
plugin files, not here (ADR 0127 decision 4).

## Consequences

- TYTO-432 (CLI) and TYTO-433 (desktop) build fetching, the lock, the sync and the cleanup
  command. TYTO-438 adds the manifest's declaration of configurable values. TYTO-439 resolves
  configurations and aliases. TYTO-440 builds the brief side. TYTO-441 merges `simulados-semana`.
  TYTO-434 and TYTO-435 move the templates, and TYTO-436 leaves `@tyto/templates` with test
  templates only.
- **The pilot's alias collides with a template that ships today.** `tabela-roxo` is a folder of
  `@tyto/templates`, and an alias equal to a real template's name is an error (decision 7). So
  the alias loads only once the built-in `tabela-roxo` is gone: TYTO-434 removes it in the same
  change that adds the plugin file, or a brief written `template: tabela-roxo` keeps rendering the
  built-in with the alias refused beside it. The same holds for the three `simulados-semana-*`
  folders and TYTO-441.
- ADR 0111's table already covers a project's plugin files, so the table gains no row. A
  restricted folder's strip lists them among what it left out.
- `fetch.ts` learns a ref. Today it only clones the default branch, and `tyto plugin install`
  may keep doing so.
- A template repository must commit built output at its release refs. A ref without
  `dist/index.js` is refused at load like any installed folder without one.
- Fetching a full commit hash at depth 1 needs a server that serves any commit it holds. GitHub
  does. A server that does not answers with a fetch error, reported as in decision 4. The fix is
  to name a tag.
- The cache grows with every commit a lock has named, until the cleanup command runs. There is no
  size limit, as with ADR 0117's cache.

## Notes

- **2026-10-29, TYTO-440.** TYTO-440 fixes the shapes of a configuration's `brief` block:
  `slots`, `formats`, `skeleton` and `editor` (a `max` per slot), the warnings
  `W_CONFIGURATION_BRIEF_INVALID`, `W_EDITOR_RULE_LOOSER` and `W_SLOT_OVER_CONFIGURED_LIMIT`,
  and that a slot that repeats takes no default. See "What a configuration sets for the brief"
  in `docs/plugin-authoring.md`. The decision above is unchanged.

## Rejected

- **npm as the template registry.** The contract is already on GitHub Packages (ADR 0149), so a
  template there would need a token on every machine that renders. A git ref needs only the
  access the person already has, and a tag is as exact as a version.
- **Fetching a branch's latest commit on every start.** A render would change because somebody
  pushed, with nothing in the folder to say so. The lock makes "what was rendered" a fact of the
  folder.
- **Installing fetched copies into `TYTO_HOME/plugins/`.** That store holds one copy per plugin
  name. Two projects locked to two commits of one repository would overwrite each other.
- **Configurations that switch pieces on and off.** That turns one template into several that
  share a name, which is what decision 1 forbids. A piece the brief chooses is an `adjustment`.
- **`_casa` as a `@tyto/template-kit/casa` subpath.** It saves one package, and it puts brand
  tokens in the kit that ADR 0047 keeps free of them, with one version for both (decision 8).
- **Merging a project entry into the machine entry, key by key.** Precedence would then depend on
  two files nobody reads together. The project replaces the entry whole, as `project.json`
  replaces a list key whole (ADR 0112).
