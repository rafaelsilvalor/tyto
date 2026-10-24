# 0111 — Nothing a source ships runs before the person trusts it

Status: accepted · 2026-10-21 · TYTO-271 · fulfils the second trigger of ADR 0079, beside ADR
0011, ADR 0032, ADR 0049 and ADR 0073; the gate TYTO-261, TYTO-278 and TYTO-347 pass; ADR 0126
adds the export presets row to the table below

## Context

ADR 0079 said no to a user-script tier and named two things that reopen the question together:
a plugin's `editor.command` that runs (TYTO-261), and **a workspace-trust rule for anything
per-project**, "because without one, cloning a project is enough to run somebody's code". This
is that rule. It is written before anything needs it, on purpose: today no project folder can
ship anything that runs, so the rule closes no door that is open now. It fixes where the door is
before the `workspace` batch builds the wall around it.

**What exists at `origin/main` 8e9c9c4, read in the code.** There is no workspace folder, no
project file and no profile. A brief's assets resolve beside it or in an `assets/` folder beside
it (ADR 0056/0057). Templates come from the person's `templatesFolder` setting, the built-in
pack and installed packs. A markup template is parsed by `template-lang` into a frame. Tyto never
imports a `template.ts` from any folder (ADR 0046, ADR 0048), and `tyto template check` reports
a code template as "code compiled into this build". Installed plugins run in their own process
under Node's permission model, reading their own folder and writing nothing (ADR 0049, ADR 0050).
**Their network is advisory** on Node 22 and 24: a plugin that imports `node:net` reaches any
host. Settings have two layers, defaults and the user file. ADR 0073 left the per-folder layer
out "because Tyto has no notion of an open project folder to anchor one to".

**What the batch adds.** TYTO-278 opens a workspace folder whose `.tyto/project.json` names
asset, template, font and output folders, plus sections owned by plugins (for example where a
Drive plugin uploads). TYTO-347 adds **work profiles**: a reusable project sheet that many
folders name and override key by key, with layers defaults → user → profile → folder. A profile
may be a file in a shared team folder. TYTO-261 makes a plugin's command run. On 2026-10-21
Rafael also asked that the rule leave the future open for **app profiles**: a bundle of settings,
keys and plugins in VS Code's sense. No card exists for that.

## Decision

### The unit of trust is a source

A **source** is a place content comes from that the person did not write into Tyto themselves:

- a **workspace folder** (TYTO-278);
- a **work profile** file outside `TYTO_HOME` (TYTO-347);
- whatever is added later on the same terms, such as an **app profile** imported from a file or
  a share. The rule is written for sources, not for projects, so an app profile or an imported
  bundle needs no new ADR to be covered. Only its list of runnable keys has to be written down.

A source is **trusted** or **restricted**. Every source starts restricted.

### What counts as runnable

Tyto gates a key or a file when acting on it could execute code, or could make code Tyto already
runs do something the person did not choose. This is the whole list today. A new kind of
per-source content joins it, or the inert list, in the pull request that adds it.

| Content a source may ship                                                   | Kind      |
| --------------------------------------------------------------------------- | --------- |
| Scripts or tasks (a step list, a command to run before or after a render)   | runnable  |
| Plugins loaded from the source itself, without `tyto plugin install`        | runnable  |
| Keybindings that bind a plugin's command (once TYTO-261 makes one run)      | runnable  |
| A per-folder or per-profile settings key that turns on something that runs  | runnable  |
| Plugin-owned sections of `project.json` or a profile                        | gated     |
| Asset, template, font and output folder keys of `project.json` or a profile | inert     |
| Export presets of `project.json` or a profile (ADR 0126)                    | inert     |
| Markup templates, fonts, images and briefs inside those folders             | inert     |
| A `template.ts` anywhere in a source                                        | never run |

**Plugin-owned sections are gated, not inert.** A section is data to Tyto (ADR 0011: the project
file only names places, plugins interpret them). But the plugin that reads it is already
installed and may reach the network, so a section that says "upload the exports to this folder"
is an instruction to code that already runs. In a restricted source, **sections are withheld**:
the plugin receives none, as if the file had none.

**A `template.ts` stays never run**, trusted or not. ADR 0046 and ADR 0048 already refuse to
import one from any folder, and trust does not change that. Code templates come from a plugin's
`build` or from this build.

**A key binding a built-in command is inert.** It runs what the person could already run from
Ctrl+K. A binding becomes runnable only once the command it names is a plugin's.

### What a restricted source can still do

Everything Tyto does today. It can open, edit, preview, check, render and export briefs with the
built-in plugins and the plugins the person installed, and it reads the source's inert keys. Two
limits apply:

1. **Every path key resolves inside the source's own folder.** This holds for reads and writes
   alike. An output folder pointing at `~/.tyto/plugins/` would plant code. An asset folder
   pointing at a private folder outside would carry its files into an export the person then
   shares. **The check runs after `realpath` on both ends**, as ADR 0046 does for a pack's
   `directory`: a junction or a symbolic link inside the folder that lands outside is outside.
   Nothing is decoded, so `%2e%2e` is a folder name. A key that leads out is a `Diagnostic` at
   that key's range, the key takes its default (tolerant per key, ADR 0073 rule 5), and its
   message says that trusting the source lifts the limit.
2. **Runnable content does not run, and gated sections are withheld.** Each is reported once,
   in one place: a banner on the open folder, not a modal. It is shown only when the source
   actually ships something restricted, so a folder with only inert keys never asks. A person
   who is never asked is never trained to click "yes".

For the folder's own folder keys, the confinement is a property of the source. A work profile's
relative paths resolve against the profile's own folder (TYTO-347), so a restricted profile is
confined to the folder it lives in, not to the workspace that names it.

### Trust never travels along a reference

A trusted workspace that names a profile does not trust the profile. A trusted profile does not
trust the workspaces that name it. Each source is approved on its own, and a trusted folder
naming a restricted profile gets that profile in restricted mode, with its own banner line.
Otherwise trusting one folder would trust whatever a file in it points at, and a shared profile
edited by somebody else would inherit the approval of every folder that names it.

**A work profile inside `TYTO_HOME` is trusted by where it lives.** It is the person's own. And
anybody who can write into `TYTO_HOME` can already plant a plugin in `TYTO_HOME/plugins/`, so
asking again buys nothing. A profile anywhere else, a team folder included, is a source like any
other.

### Where approvals live, and how they are taken back

**One file per user: `trust.json` in `TYTO_HOME`** (`~/.tyto/trust.json`, or under `$TYTO_HOME`).
It is JSONC, as ADR 0073's settings are, and holds one entry per trusted source, keyed by its
real path, with the date it was approved.

- **Never inside a source.** A `trust.json`, or anything else resembling an approval, found in a
  workspace's `.tyto/` or beside a profile is not read. A source cannot vouch for itself.
- **Not in the per-version data folder of ADR 0032.** An approval is about the folder, not about
  the build. It is shared by the CLI and the desktop, which both already read `TYTO_HOME` for
  installed plugins, and an update must not silently forget it or ask everything again.
- **The key is the real path.** It is resolved with `realpath` before it is written and before
  it is compared. On Windows the comparison ignores case, as the file system does. The file keeps
  the path's own spelling, so the person reads back what they approved.
- **A moved or renamed folder is a new source and asks again.** Trust is keyed by where the
  content is, not by what it is. A folder that reappears somewhere else is, as far as Tyto can
  know, a different folder. This is intended, not a bug.
- **Revoking** is removing the entry: from a command in the window ("Workspace: Manage Trust",
  built with the workspace UI), with `tyto trust remove <folder>`, or by editing the file by hand.
  It takes effect the next time the source is opened. A window that has the source open keeps it
  as it was until then, because withdrawing a running plugin's section mid-export is a failure
  mode with no upside.

### Where the check lives

**`core` and the other pure packages never read `trust.json`.** The trust store is an adapter
behind a port, in the place `CLAUDE.md` puts adapters: the port in `core` or `plugin-api`, the
file-backed adapter in an I/O package, and composition in `apps/*` only. The resolvers TYTO-278
and TYTO-347 build, for the project file and the profile, receive an answer per source,
`trusted` or `restricted`. They never receive a path to the store, so they stay pure functions a
test can call with either answer. The CLI composes the same adapter as the desktop.

### The CLI

Running `tyto render` in a shell stays what ADR 0079 calls ordinary: the person or the pipeline
chose to run Tyto. But `git clone … && tyto render …` is the exact case this ADR exists for, so
**the CLI follows the same rule**. A source is trusted if the store says so, or for one run with
`--trust`, which is never written to the store. Without either, the CLI renders in restricted
mode and prints the same diagnostics the banner would show. CI that renders a repository it
checked out passes `--trust` on purpose. A path typed as a flag (`--templates`, `--out`) is the
person's own choice and not a source's content, so it is not confined.

### Names

"Work profile" is TYTO-347's reusable project sheet. **"App profile" is reserved** for a future
bundle of the person's settings, keys and plugins, so the two are never one word for two things.

## Consequences

- No code in this pull request. No runnable per-source content exists yet. The store, its port,
  the banner, `--trust` and `tyto trust remove` are built by the first card that ships something
  restricted: TYTO-278 for path confinement and withheld sections, TYTO-261 for plugin commands
  bound by a project's keys. Each perturbs its check and pastes the red output, as usual.
- TYTO-278's resolver must take a trust answer from its first pull request, even though only the
  confinement and the withheld sections depend on it then. A resolver built without the parameter
  would have to change its signature the day the first runnable key arrives.
- ADR 0073's per-folder settings layer, when it is built, takes the narrower key set it promised
  from the table above: a key that turns on something that runs is ignored in a restricted
  source, with a diagnostic at the key.
- ADR 0079's second trigger now exists. Its first, TYTO-261, does not yet, so user scripts stay
  where ADR 0079 left them. That ADR is not edited: this one fulfils it and changes none of it.
- A new kind of per-source content (an app profile, an imported bundle, a per-project snippet
  file) states its row in the table in the pull request that adds it.
- Risk to watch: a workspace folder opened at the person's home directory. Its `.tyto/` would be
  `TYTO_HOME` itself, beside `plugins/` and `trust.json`. TYTO-278 decides whether that folder is
  refused or simply never read as a project file. This ADR only requires that `trust.json` is
  never taken as a source's own content.
- Not measured: whether a markup template's CSS can make the raster fetch from the network
  during an export. If it can, a template folder is less inert than the table says, for trusted
  and restricted sources alike. That belongs to the export path, not to trust.
