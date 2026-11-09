# Terminal

::: info How this page was checked
Opening a terminal, typing into it, the window's keys from inside it, two terminals, the two widths and both colour schemes were followed on 2026-10-31 on a development build of Tyto from the branch that added this page, on Windows 11, in the English window. Open an Agent Here was run on 2026-11-09 by the project's automated tests on the branch that added it (TYTO-567), with a stand-in agent that does what Claude Code does with the same arguments, on Windows 11; it was not followed in a window. The shells, the quit and the restricted folder were also run on Linux and macOS by the project's automated tests, not looked at in a window there. The Portuguese edition's labels were read from the window's own catalogue.
:::

The **Terminal** tab of the bottom area runs your own shell, the one your system opens in a terminal window, inside Tyto. Unlike [Commands](commands.md), which runs only `tyto` commands, a terminal runs any program: `git`, `npm`, an editor, a Python prompt.

**The shell runs as you, with your permissions, and Tyto's rules do not apply inside it.** A folder's trust and a plugin's permissions stop at the terminal: what you type there runs as it would in any terminal on your machine.

## Open it

- **Ctrl+Shift+`** opens a new terminal in front, opening the bottom area if it was hidden. It is the key left of **1**, with Shift, whatever your keyboard prints on it: on a Brazilian keyboard that key prints an apostrophe.
- **Terminal: New Terminal** in the command bar does the same.
- Or click **TERMINAL** at the top of the bottom area. With no terminal open yet, the first one starts.

**Ctrl+`** stays on [Commands](commands.md).

## Which shell

- **Windows**: PowerShell 7 (`pwsh`) when it is installed, otherwise Windows PowerShell.
- **macOS**: your login shell, started as a login shell so it reads the same `PATH` as a terminal window.
- **Linux**: your login shell (`$SHELL`).

To run another program, set `terminalShell` and `terminalArgs` in `settings.json` (see [Settings](../reference/settings.md#terminalshell)). They are read from that file only: a workspace folder cannot choose the program a terminal runs.

## Where it starts

A new terminal starts in the open [workspace folder](workspace-folder.md), or in your home folder when none is open. A terminal already open stays in the folder it started in when you open another folder.

## In a restricted folder

While the open folder is not trusted, a new terminal is refused, and the tab says so with **Trust the folder** beside it. A shell started in a folder can run that folder's files before you type anything: prompt tools run `git` there, and a copied folder's settings can name a program for `git` to start. Trusting the folder opens the terminal. A terminal already open keeps running.

## More than one

**+** opens another terminal. With two or more, they show as small tabs at the right of the strip, named after the shell and numbered when two share a name. A tab's **×** ends that shell and every program it started.

## Open an agent here

**Terminal: Open an Agent Here**, in the command bar and the **Tools** menu, starts an AI agent program in a new terminal, in the open folder, already connected to this window: it can read the brief in front, check it and propose edits you accept or reject, as [Connect an AI agent](../command-line/agents.md#work-with-the-window-that-is-open) describes.

- The program is `claude` (Claude Code) unless `agentCommand` in `settings.json` names another, such as `"codex"`. `agentArgs` adds arguments of your own, such as `["--model", "opus"]`. Both are read from that file only (see [Settings](../reference/settings.md#agentcommand)).
- **Tyto installs no agent.** When the program is not installed, the tab says so and nothing starts.
- Claude Code and Codex are told where the window is when they start. Nothing is written into your folder: the connection's settings go in your Tyto folder.
- In a folder you have not trusted, the agent is refused as a terminal is. With no folder open it starts in your home folder and can only read.
- With `agentsListen` set to `false`, the command says so instead of starting an agent that could not connect.

Any terminal Tyto opens tells the programs in it which window opened it. An agent you start there by hand reaches this window if you registered Tyto with it ([Connect an AI agent](../command-line/agents.md#from-tyto-s-terminal)).

## Copy and paste

- **Windows and Linux**: **Ctrl+C** copies when text is selected; with nothing selected it goes to the shell, which stops the program running. **Ctrl+Shift+C** and **Ctrl+Shift+V** copy and paste.
- **macOS**: **Cmd+C** and **Cmd+V**.

A paste of more than one line asks first, because the shell runs each line as it arrives.

## Keys

While a terminal has focus, keys go to the shell, except Tyto's own keys that work anywhere: **Ctrl+K** opens the command bar, **Ctrl+`** shows Commands, **Ctrl+Shift+`** opens another terminal, and the zoom keys zoom. In `keybindings.json`, an entry with `"when": "terminal"` works only while a terminal has focus.

## Colours and font

A terminal uses the window's colours, in light and dark, and the editor's code font and size (`codeFontFamily` and `codeFontSize`). A prompt that draws symbols from a Nerd Font shows them as boxes until `codeFontFamily` names a font that has them.

## When it ends

- When the shell exits, the terminal says **Process exited with code** and the number, and its tab stays until you close it.
- Reloading the window keeps every terminal, with what it last showed, up to its last 256 KiB.
- Quitting Tyto ends every shell. On macOS and Linux, if a program other than the shell is still running, Tyto asks first. On Windows it does not ask, because it cannot tell an idle shell from a busy one.

## Not yet

Clicking a link in a terminal and splitting a terminal in two are not there yet.
