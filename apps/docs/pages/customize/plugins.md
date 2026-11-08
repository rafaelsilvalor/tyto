# Plugins

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `b039537`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

A **plugin** adds to Tyto: templates, colour themes, file types to export, and more. Some come with Tyto and are always there; others you install.

## See what is installed

Run **Show plugins** from the command bar or the **File** menu, or click the plugins button in the status bar. The dialog lists every plugin — the ones Tyto comes with as _built-in_, yours as _installed_ — with its version, whether it is enabled, what it adds and the permissions it was given. It also says which folder installed plugins live in.

## Install, switch off and remove

::: info Checked differently
This section was added on 2026-11-08. Installing from a folder, removing and Settings were checked by the app's end-to-end tests, with the system's file picker and boxes answered by the test; installing from an archive was checked by unit tests. Nobody has followed it by hand yet.
:::

From the plugins dialog, with no terminal:

1. Click **Install from folder…** and choose the plugin's folder, or **Install from archive…** and choose its `.tgz` or `.tar.gz` file.
2. A box shows the plugin's name, what it adds and every permission it asks for — the same text `tyto plugin install` prints. Click **Install** to approve. **Cancel**, Escape or closing the box installs nothing.
3. The plugin appears in the list with _restart to apply_.

On an installed plugin's row:

| Button       | What it does                                                                             |
| ------------ | ---------------------------------------------------------------------------------------- |
| **Disable**  | switches it off without removing it                                                      |
| **Enable**   | switches it back on                                                                      |
| **Remove**   | deletes its folder and the permissions you approved, after a box whose default is Cancel |
| **Settings** | opens `settings.json` at the plugin's first setting, for a plugin that has settings      |

A plugin that comes with Tyto has no buttons. Plugins installed from the gallery are managed in the gallery.

The window starts plugins when it opens, so every change takes effect the next time you open Tyto: until then the row says _restart to apply_. A plugin switched off is shown as _disabled_, and what it added — its templates, its themes — is gone from the window once Tyto starts again.

The same changes can be made from a terminal, with the commands in [Plugins](../command-line/plugins.md):

| To                                                       | Run                            |
| -------------------------------------------------------- | ------------------------------ |
| install one from a folder, a `.tgz` file, a git URL, npm | `tyto plugin install <source>` |
| switch one off without removing it                       | `tyto plugin disable <name>`   |
| switch it back on                                        | `tyto plugin enable <name>`    |
| remove one                                               | `tyto plugin remove <name>`    |

## Is a plugin safe?

Each installed plugin runs apart from the window, so a plugin that crashes stops itself and not Tyto, and it can only reach what its permissions allow. The dialog shows those permissions, and both its install box and `tyto plugin install` show them before you approve. Writing a plugin is in the [plugin author's guide](../extend/plugin-authoring.md).
