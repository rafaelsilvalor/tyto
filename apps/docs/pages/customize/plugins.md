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

The remove box has a checkbox, **Also forget this plugin's saved credentials and sign-ins**, which starts unticked. Unticked, what you saved for the plugin in the system keychain stays — its credentials, its sign-ins and any sign-in client you entered — and installing the plugin again finds all of it. Ticked, all of it is deleted along with the folder, and that cannot be undone: a reinstall finds nothing, and you sign in again. Nothing of any other plugin is touched. `tyto plugin remove` never forgets them; it says so when it finishes.

The window starts plugins when it opens, so every change takes effect the next time you open Tyto: until then the row says _restart to apply_. A plugin switched off is shown as _disabled_, and what it added — its templates, its themes — is gone from the window once Tyto starts again.

The same changes can be made from a terminal, with the commands in [Plugins](../command-line/plugins.md):

| To                                                       | Run                            |
| -------------------------------------------------------- | ------------------------------ |
| install one from a folder, a `.tgz` file, a git URL, npm | `tyto plugin install <source>` |
| switch one off without removing it                       | `tyto plugin disable <name>`   |
| switch it back on                                        | `tyto plugin enable <name>`    |
| remove one                                               | `tyto plugin remove <name>`    |

## Give a plugin its key

::: info Checked differently
This section was added on 2026-11-12 and checked by the app's end-to-end test, with a made-up key file shaped like a service account's. Nobody has followed it by hand with a real key yet.
:::

A plugin that works with a service of yours may ask for a key — an API token, or a service account's key file — with a `credentials:` permission. Its row shows one line per key: the key's name, whether it is **set** or **not set**, a field, **Save**, **Import from file…**, and **Clear** once something is stored.

- **A key file**, such as the JSON key a cloud console downloads: click **Import from file…** and pick the file. Tyto reads it and stores its text exactly as it is, line breaks included. A file over 16 KiB, empty, or not text is refused, and the line says why.
- **A key you copied**: paste it in the field and click **Save**, or press Ctrl+Enter. The field keeps line breaks, so a key of several lines arrives whole; Enter starts a new line.

Either way the key goes to your system's keychain. Tyto never shows it again — the field is masked while you type and empty once saved, and the line only says **set**. To replace it, store a new one; **Clear** forgets it.

## Sign in for a plugin

::: info Checked differently
This section was added on 2026-11-08 and checked by the app's end-to-end test against a test sign-in service on this computer, with the browser's part answered by the test. Nobody has followed it by hand with a real provider yet.
:::

Some plugins work with your own account somewhere else — a connector that creates files in your storage, say. Such a plugin asks for a `signin:` permission, and its row in the plugins dialog shows one line per sign-in it declares:

1. The line says **Not signed in**. Click **Sign in**.
2. Your browser opens on the provider's page. Sign in there and approve. The browser then shows a page from Tyto saying you are signed in; you can close that tab.
3. Back in the dialog, the line says **Signed in as** and the account, or just **Signed in** when the provider does not say who.

While the browser is open, the line says to finish signing in there and has **Cancel**. If you closed the browser tab or picked the wrong account, click **Cancel**: the attempt ends at once, nothing is kept, and you can click **Sign in** again.

Click **Sign out** to end it. Nothing else starts a sign-in: a plugin that needs one when you are signed out stops and tells you to sign in from this dialog, and it never opens your browser by itself.

Tyto keeps the sign-in in your system's keychain, and the plugin gets only a short-lived access token from Tyto, never what keeps you signed in. On a computer with no keychain to encrypt with, the sign-in does not finish and the line says why. The command line cannot sign in through a browser: a recipe that needs a sign-in works only in the window.

### A sign-in that asks for your own client

::: info Checked differently
This section was added on 2026-11-11 and checked by the app's end-to-end test, which types a client on the screen and signs in against a test sign-in service that accepts only that client. Nobody has created a client with a real provider and followed it by hand yet.
:::

A provider recognises the app that asks you to sign in by its **OAuth client**: a client ID, and sometimes a client secret. Some plugins name their own client. Others leave it to you, so that a team can use its own client without writing it into a plugin anybody can read. On such a sign-in the line also shows **OAuth client: not set**, two fields and **Save**, and **Sign in** stays off until a client is set:

1. Type the **Client ID** and, when your provider gave you one, the **Client secret (optional)**. Click **Save**.
2. The line says **OAuth client: set**, and the fields are empty again: Tyto never shows the client back. Click **Sign in** and go on as above.

Tyto keeps the client in your system's keychain, beside the sign-in, never in `settings.json`. **Saving another client, or clicking Clear, signs you out** of that sign-in, because what kept you signed in was issued to the old client. A plugin that names its own client shows no fields: its client cannot be replaced.

Somebody on your team may hand you the client. To create one yourself, with a provider that issues clients per project — Google Cloud, for example:

1. Open the provider's console and choose or create a project.
2. Configure the consent screen the provider asks for, and add yourself as a test user if the app stays in testing.
3. Enable the APIs the plugin says it uses.
4. Create an OAuth client of the type **Desktop app**. Tyto signs in through your browser and a port on this computer only, which is what that type allows.
5. Copy the client ID and the client secret into the fields above. A desktop client's secret is not confidential: every installed copy of an app carries it.

## Plugins that start a program

::: info Checked differently
This section was added on 2026-11-09 and checked by the app's end-to-end tests with a stand-in program on this computer. Nobody has followed it by hand with a real agent yet.
:::

Some plugins work by talking to another program on your computer — an agent panel that talks to the `claude` command you already use, say. Such a plugin asks for a `process:` permission naming that one program, and you see it before you approve: `process:claude` reads **start the program claude on your computer** in the install box, and the plugin's row in the plugins dialog lists the programs it may start.

- **Tyto starts the program, not the plugin**, and only the one named: `process:claude` does not start anything else. The program is the one your `PATH` finds, so it is the same `claude` you run in a terminal, logged in the same way. Tyto installs no program: when it is not there, the plugin is told so and can tell you.
- **It runs in the folder open in Tyto, and never while that folder is restricted.** Opening another folder, or trusting or distrusting this one, ends the programs a plugin started; so does closing the window.
- **It runs as you.** The program can read and change what you can. It gets the folder it runs in and a few settings of your system, such as where your home folder is and your proxy, and never Tyto's secrets or a variable whose name looks like a key or a token.
- **It can reach the Tyto window as an agent**, while `agentsListen` is on in your settings: the plugin can tell it how. It then reads what is open in the window, and a change it wants to make arrives as a proposal you approve or reject, as with an agent you open in a Tyto terminal. The install box says so beside the program's name. Turning `agentsListen` off, or a restricted folder, keeps it out.

A plugin that adds a new program in an update is not started until you approve it again. The command line starts no programs for plugins.

### A program the plugin brings with it

Some plugins bring their program with them instead of asking you to install it, such as an agent panel that ships the small adapter it talks through. That program is **the plugin's own code**: Tyto runs it with the Node it ships with, and it does not look for it on your `PATH`. The install box says so: `process:claude-agent-acp` reads **run this plugin's own program claude-agent-acp (adapter/claude-agent-acp.mjs) on Tyto's Node**, and a paragraph below says what that means. The plugins dialog lists such programs on a line of their own.

- **It is not confined like the plugin is.** The plugin itself cannot read your files, but its program can read and change them and reach the network, as any program you run can. Approving it means trusting whoever wrote the plugin.
- **The rules above still hold.** It runs only from the plugin's own folder, in the folder open in Tyto, never while that folder is restricted, without Tyto's secrets or a variable that looks like a key or a token, and at most two of a plugin's programs run at once. When the file is missing from the plugin's folder, the plugin is told to have you reinstall it.
- **It has a folder of its own for what it keeps**, such as something it downloads the first time you use it. The folder is inside Tyto's own folder (`~/.tyto/data/plugins/<plugin>`), it stays when the plugin is updated, and it is deleted when you remove the plugin. Tyto gives the same folder to every program a plugin starts, including one from your `PATH`.

### A terminal a plugin opens

A plugin may open a tab in Tyto's **Terminal** running one of the programs it declares, for something that needs you at the keyboard, such as signing in to an agent. The tab opens in front, in the folder open in Tyto, and you see everything the program prints. The plugin only learns that the tab opened: it never sees what the program prints or what you type. One such tab per plugin is open at a time; close it, or let the program finish, before the plugin opens another. The tab stays yours: it does not close when the plugin stops.

## Is a plugin safe?

Each installed plugin runs apart from the window, so a plugin that crashes stops itself and not Tyto, and it can only reach what its permissions allow. The dialog shows those permissions, and both its install box and `tyto plugin install` show them before you approve. Writing a plugin is in the [plugin author's guide](../extend/plugin-authoring.md).
