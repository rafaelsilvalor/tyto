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

## Start your own

`tyto plugin new my-pack` writes a plugin folder with one template in it, ready to install; the [plugin author's guide](../extend/plugin-authoring.md) goes on from there. Every option of every `plugin` command is in the Reference's [Command line](../reference/command-line.md#tyto-plugin-list).
