# Plugins

::: info How this page was checked
Every command was run on 2026-10-19 on a build of the repository at commit `b039537` (CLI 0.4.1) on Windows 11, with `TYTO_HOME` set to an empty folder. The outputs below are copied from those runs.
:::

A **plugin** adds to Tyto: templates, colour themes, file types, and more. The `tyto plugin` commands install and manage them, and the window uses whatever they installed — [Plugins](../customize/plugins.md) in Customize shows that side. Writing one is the [plugin author's guide](../extend/plugin-authoring.md).

Installed plugins live in `~/.tyto/plugins` (`%USERPROFILE%\.tyto\plugins` on Windows), shared by every version of the app. The `TYTO_HOME` environment variable moves that folder.

## Install

`tyto plugin install` takes a folder, a git URL or an npm package name. It shows what the plugin adds and the permissions it asks for, and wants your approval before installing. `--yes` gives it on the command line; without it, a run with nobody at the terminal to answer — a script — stops with _Nobody is at a terminal to answer; run again with --yes._

<!-- The question asked in a real terminal was not measured: the author's runs had no terminal attached (TYTO-317). -->

```
$ tyto plugin install ./my-pack --yes
my-pack 0.1.0 from ./my-pack
contributes: template-pack
permissions:
  (none)
Each plugin runs in a process of its own, so a crash stops the plugin and not Tyto.
Node's permission model confines that process to the plugin's own folder: it cannot
read your other files, write anywhere, or start programs. It is not confined on the
network: net: permissions filter host.fetch only, and a plugin that opens its own
connection is not stopped. credentials: permissions filter host.credentials.
Installed my-pack 0.1.0.
```

Read the permissions before you approve: a plugin that asks for none, like this one, can reach nothing outside its own folder. Installing **copies** the plugin, so the folder you installed from can be moved or deleted afterwards.

A window that is already open starts the new plugin the next time it opens.

## See what is installed

```
$ tyto plugin list
html                0.4.2  built-in  enabled  exporter
svg                 1.0.2  built-in  enabled  exporter
built-in-templates  0.1.0  built-in  enabled  template-pack
chromium            0.1.0  built-in  enabled  rasterizer
fs-inbox            1.0.3  built-in  enabled  source
fs-outbox           1.0.3  built-in  enabled  sink
my-pack             0.1.0  external  enabled  template-pack
```

Each line is the name, the version, where it came from, whether it is on, and what it adds. `--active` lists only the ones a render would start.

## Switch one off, and back on

```
$ tyto plugin disable my-pack
Disabled my-pack.
$ tyto plugin enable my-pack
Enabled my-pack.
```

A disabled plugin stays installed and is left out of every render and of the window, which is the way to tell whether a problem comes from it.

## Remove

```
$ tyto plugin remove my-pack
Removed my-pack.
```

## Fetch templates from their own repositories

A **plugin file** names a repository to fetch a plugin or its templates from, and the version to fetch. The machine's are in `~/.tyto/plugin-files`; a project's are in `.tyto/plugin-files` beside its briefs, and count only once the folder is trusted. A project's entry for a template wins over the machine's.

<!-- The commands in this section were run on 2026-10-29 on a build of the branch feat/TYTO-432-plugin-files-sync, on Windows 11, with TYTO_HOME set to an empty folder and the example pack committed to a repository two folders up, tagged v1.0.0. -->

```yaml
# ~/.tyto/plugin-files/avisos.yaml
version: 1
templates:
  aviso:
    source:
      git: ../../my-pack # any address your git reads: https://…/repo.git, git@…, a folder
      ref: v1.0.0 # a tag, a branch or a full commit
```

A folder that starts with `./` or `../` is read from the plugin file's own folder. `tyto plugin sync` fetches each source with your own `git` — your credentials, SSH keys and proxy, nothing stored by Tyto — and writes the commit it got in `plugin-files.lock.json`, beside the files:

```
$ tyto plugin sync
example-pack  ../../my-pack  v1.0.0  c50a1231d0be  home\plugin-files\avisos.yaml
```

**`tyto render` does the same before it renders**, so a render reaches the network only when a copy is missing, the first time, and otherwise uses what is already on this computer. It never moves what the lock pinned: a branch somebody pushed to stays where the lock says until you run `tyto plugin sync --update`. A project's lock belongs in its version control, so everybody renders the same commit. `tyto watch` never fetches.

Without a network, the copy fetched before is used, and the run says so:

```
$ tyto plugin sync --update
example-pack  ../../my-pack  v1.0.0  c50a1231d0be  home\plugin-files\avisos.yaml
warning W_PLUGIN_FILE_FETCH Could not fetch '../../my-pack' at 'v1.0.0': fatal: 'C:\Users\rafae\AppData\Local\Temp\t432\my-pack' does not appear to be a git repository. The copy of commit c50a1231d0be435c0717c2fd89715f2a68d755f6 fetched earlier loads.
```

A template removed from the files stops loading at once; its copy stays until `tyto plugin clean` deletes the copies no lock names:

```
$ tyto plugin clean
home\cache\plugin-files\94529b5cf90e68c9814015bbcf2aac31f959747fb4e294710d4d3dfcc98b0fc3\c50a1231d0be435c0717c2fd89715f2a68d755f6
Removed 1 cached copy.
```

A fetched plugin that asks for permissions is shown and asked about by `tyto plugin sync`, as `install` does, or approved with `--yes`; a render never asks, and skips one nobody approved.

`tyto plugin list` shows what the plugin files name below the installed plugins: the plugin, whether the file is the machine's or the project's, the source, the ref, the commit the lock pins and whether a render loads it (`approved`, `not approved`, `not synced` before the first sync, `refused` when the commit is not a plugin this Tyto can load). Then every alias, with the template and configuration it reaches. It reads only what is on this computer: it fetches nothing and runs no plugin.

```
$ tyto plugin list
…
plugin files:
example-pack  machine  ../../my-pack  v1.0.0  c50a1231d0be  approved  home\plugin-files\avisos.yaml

aliases:
aviso-laranja → aviso (laranja)  home\plugin-files\avisos.yaml
```

In a folder that is not trusted, the project's plugin files are neither loaded nor listed, and `tyto render` and `tyto plugin list` say so in one line naming `.tyto/plugin-files`.

**The desktop app runs the same sync** when it starts, when it opens a workspace folder, and on **Plugins: Sync Plugin Files** and **Plugins: Update Plugin Files** (Ctrl+K), the second moving every ref as `--update` does. The templates it fetches are in the template list; a repository that did not answer is a row in the problems panel that names it, and the copy fetched before keeps working. A plugin that asks for permissions is asked about in a box. In a folder you have not trusted yet, the project's plugin files are not fetched, and the trust strip counts them among what it left out.

### Configurations and aliases

A fetched pack offers only the templates its file names. Each template can have named **configurations**, which set the values the template declares it lets you change, such as a colour, a size, a face or an image. A brief reaches a configuration by its **alias**: write `alias:` to choose it, or leave it out and the alias is the template's name, a dash and the configuration's name. `default:` names the configuration a brief gets when it writes the template's own name, and every other configuration starts from that one and changes only what it lists. An image path is read from the plugin file's own folder and must stay inside the project, or inside `~/.tyto` for the machine's files.

```yaml
# ~/.tyto/plugin-files/avisos.yaml
version: 1
templates:
  aviso:
    source:
      git: ../../../my-pack
      ref: v1.0.0
    configurations:
      laranja: # a brief writes `template: aviso-laranja`
        values:
          paper: '#ffffff'
```

<!-- Run on 2026-10-29 on a build of the branch feat/TYTO-439-configurations-and-aliases, on Windows 11, with TYTO_HOME=home and the example pack committed to a repository three folders up from the file, tagged v1.0.0. -->

A value the template does not declare, or one outside its limits, is a warning at the line that wrote it, and the template's own value stands:

```
$ tyto render aviso.brief --out out --types svg
home\plugin-files\avisos.yaml:10:18: warning W_TEMPLATE_VALUE_UNKNOWN Template 'aviso' declares no configurable value 'paper'; the setting is ignored.
```

An alias may never be a template's name: `E_TEMPLATE_ALIAS_TAKEN` points at it, the alias does not load, and the template of that name renders as before. The same alias in two files of one folder loads from neither, and a project's alias wins over the machine's.

## Start your own

`tyto plugin new my-pack` writes a plugin folder with one template in it, ready to install; the [plugin author's guide](../extend/plugin-authoring.md) goes on from there. Every option of every `plugin` command is in the Reference's [Command line](../reference/command-line.md#tyto-plugin-list).
