# Plugins

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `b039537`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

A **plugin** adds to Tyto: templates, colour themes, file types to export, and more. Some come with Tyto and are always there; others you install.

## See what is installed

Run **Show plugins** from the command bar or the **File** menu, or click the plugins button in the status bar. The dialog lists every plugin — the ones Tyto comes with as _built-in_, yours as _installed_ — with its version, whether it is enabled, what it adds and the permissions it was given. It also says which folder installed plugins live in.

## Install, switch off and remove

The window shows plugins; it does not install them. That is done from a terminal, with the commands in [Plugins](../command-line/plugins.md):

| To                                          | Run                            |
| ------------------------------------------- | ------------------------------ |
| install one from a folder, a git URL or npm | `tyto plugin install <source>` |
| switch one off without removing it          | `tyto plugin disable <name>`   |
| switch it back on                           | `tyto plugin enable <name>`    |
| remove one                                  | `tyto plugin remove <name>`    |

The window starts plugins when it opens, so a change made while it is open takes effect the next time you open it. A plugin switched off is shown as _disabled_ in the dialog, and what it added — its templates, its themes — is gone from the window until you switch it back on.

## Is a plugin safe?

Each installed plugin runs apart from the window, so a plugin that crashes stops itself and not Tyto, and it can only reach what its permissions allow. The dialog shows those permissions, and `tyto plugin install` shows them before you approve. Writing a plugin is in the [plugin author's guide](../extend/plugin-authoring.md).
