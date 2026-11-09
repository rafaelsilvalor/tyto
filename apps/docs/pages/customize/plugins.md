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

## Sign in for a plugin

::: info Checked differently
This section was added on 2026-11-08 and checked by the app's end-to-end test against a test sign-in service on this computer, with the browser's part answered by the test. Nobody has followed it by hand with a real provider yet.
:::

Some plugins work with your own account somewhere else — a connector that creates files in your storage, say. Such a plugin asks for a `signin:` permission, and its row in the plugins dialog shows one line per sign-in it declares:

1. The line says **Not signed in**. Click **Sign in**.
2. Your browser opens on the provider's page. Sign in there and approve. The browser then shows a page from Tyto saying you are signed in; you can close that tab.
3. Back in the dialog, the line says **Signed in as** and the account, or just **Signed in** when the provider does not say who.

Click **Sign out** to end it. Nothing else starts a sign-in: a plugin that needs one when you are signed out stops and tells you to sign in from this dialog, and it never opens your browser by itself.

Tyto keeps the sign-in in your system's keychain, and the plugin gets only a short-lived access token from Tyto, never what keeps you signed in. On a computer with no keychain to encrypt with, the sign-in does not finish and the line says why. The command line cannot sign in through a browser: a recipe that needs a sign-in works only in the window.

## Plugins that start a program

::: info Checked differently
This section was added on 2026-11-09 and checked by the app's end-to-end tests with a stand-in program on this computer. Nobody has followed it by hand with a real agent yet.
:::

Some plugins work by talking to another program on your computer — an agent panel that talks to the `claude` command you already use, say. Such a plugin asks for a `process:` permission naming that one program, and you see it before you approve: `process:claude` reads **start the program claude on your computer** in the install box, and the plugin's row in the plugins dialog lists the programs it may start.

- **Tyto starts the program, not the plugin**, and only the one named: `process:claude` does not start anything else. The program is the one your `PATH` finds, so it is the same `claude` you run in a terminal, logged in the same way. Tyto installs no program: when it is not there, the plugin is told so and can tell you.
- **It runs in the folder open in Tyto, and never while that folder is restricted.** Opening another folder, or trusting or distrusting this one, ends the programs a plugin started; so does closing the window.
- **It runs as you.** The program can read and change what you can. It gets the folder it runs in and a few settings of your system, such as where your home folder is and your proxy, and never Tyto's secrets or a variable whose name looks like a key or a token.

A plugin that adds a new program in an update is not started until you approve it again. The command line starts no programs for plugins.

## Is a plugin safe?

Each installed plugin runs apart from the window, so a plugin that crashes stops itself and not Tyto, and it can only reach what its permissions allow. The dialog shows those permissions, and both its install box and `tyto plugin install` show them before you approve. Writing a plugin is in the [plugin author's guide](../extend/plugin-authoring.md).
