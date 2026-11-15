# Commands

::: info How this page was checked
Every step was followed on 2026-10-30 on a development build of Tyto from the branch that added this page, on Windows 11, in the English window. The Portuguese edition's labels were read from the window's own catalogue, not from a running window. The run blocks and the place of the suggestion list were checked again on 2026-10-31, once this page described them. The refusals of `tyto mcp`, `watch` and `recipe run --apply` were added to this list on 2026-11-12 from the window's code and its unit tests, the last one through the command line's own parser, not in the window. The panel's own commands, `&&`, `!N` and patterns were added on 2026-11-15 from the window's code and its unit tests, not in the window. The file commands `ls`, `cd`, `pwd` and `cat`, and completion after them, were added on 2026-11-15 from the window's code and its unit tests; the prompt showing a folder after `cd` was looked at in the window, in the light and dark themes. `new`, `mkdir`, `mv`, `cp`, `rm`, `open` and `reveal` were added the same day from the window's code and its unit tests, not in the window. Aliases and variables were added on 2026-11-15 from the window's code and its unit tests, not in the window. The boxes a refusal offers were added on 2026-11-15: the ones for `--trust` and `recipe run --apply` were followed in the window, with both answers; the ones for `signin`, `signout` and `watch` come from the window's code and its unit tests.
:::

The **Commands** tab of the bottom area runs `tyto` commands, the same ones as the [command line](../command-line/index.md), inside the window, and a few commands of its own. Nothing else runs there: not a shell and not another program. For a shell, use the [Terminal](terminal.md) tab.

## Open it

- **Ctrl+`** opens the bottom area on Commands with the cursor on the prompt. It is the key left of **1**, whatever your keyboard prints on it: on a Brazilian keyboard that key prints an apostrophe. Pressed again while Commands is in front, it hides the area.
- **Commands: Run…** in the command bar does the same.
- Or click **COMMANDS** beside **PROBLEMS** at the top of the bottom area.

The bottom area shows one tab at a time. Its **×** hides the whole area, and everything in it is there when it comes back.

## Run a command

Type after `tyto ›` and press **Enter**. Writing `tyto` first is optional.

- Words are split on spaces. Put a path with spaces in quotes: `render "Meus briefs/cartaz.brief"`. A quote left open is refused and nothing runs.
- `|`, `>`, `;` and `~` mean nothing here. They reach the command as words. `&&`, `!N`, `*` and `?` are read by the panel, as [Several commands in one line](#several-commands-in-one-line) says, and `$name` and aliases as [Aliases and variables](#aliases-and-variables) says.
- The command runs in the panel's folder: the open [workspace folder](workspace-folder.md), or the folder inside it that `cd` went to, which the prompt shows (`tyto entregas/novembro ›`). A path can be written from there. With no folder open, it runs in your Tyto folder (`~/.tyto`). A folder's trust is the workspace folder's: under a restricted folder, every folder is restricted too.
- Some commands are refused, with a line saying why:
  - `--trust`, because the window trusts a folder with **Workspace: Manage Trust**. With a folder open, a box offers to trust it there and then run the command without `--trust`. Unlike `--trust`, which lasts one run, this trust is saved: the folder stays trusted until you take it back in **Workspace: Manage Trust** or with `tyto trust remove`;
  - installing an npm package with `plugin install` on Windows, because that would start a shell;
  - `tyto mcp`, because it talks to an agent over its input and output, which the panel does not have;
  - `watch` on the [queue folder](../export/queue-folder.md) while **Render automatically** is on, because that folder already has a consumer. A box offers to turn **Render automatically** off and watch there; it stays off until you turn it back on in the queue panel;
  - `recipe run` with `--apply`, because the panel only plans a recipe: apply the plan with **Apply** in the recipe's notebook, or run the command in a terminal. A box offers to open the recipe's notebook; opening it applies nothing. `recipe run` without `--apply` runs and prints the plans.
  - `signin` and `signout`, because the window signs in from the [plugins screen](../customize/plugins.md); the terminal keeps sign-ins of its own. When the plugin declares one sign-in, or you name it, a box offers to sign in or out as the plugins screen does. The terminal's sign-in is not touched.
- A box that offers the window's way names the folder, plugin or recipe it acts on. **Cancel** is the default, and Escape answers it: the command stays refused and nothing changes. `tyto mcp` and an npm install on Windows offer no box.
- A command that needs an answer, such as approving a plugin's permissions, asks in a box of the window's own.

Each command you run is a block. Its header shows the command, with its paths cut to the file name (the whole line is the tooltip), the time it started and how it ended: **✓ 0** when it went well, **✗ 1** when the brief has errors, **✗ 2** when Tyto itself failed, **✗** alone for a line refused before it ran, `–` when stopped and `•` while it runs. What the command printed is under the header. Whether the newest run comes last or first, and whether older runs fold to their header, are two settings, described in [Panels](panels.md#commands).

## The panel's own commands

These are not `tyto` commands: the panel answers them itself. Those that only read also run in a [restricted folder](workspace-folder.md); `new`, `mkdir`, `mv`, `cp`, `rm`, `open` and `reveal` do not, and say so. Writing `tyto` first sends the line to the command line instead: `tyto help` is its own help.

| Command          | What it does                                                                                                                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `help`           | Lists these commands and the `tyto` commands. `help render` shows the help of `tyto render`.                                                                                                                                                                                                        |
| `clear` or `cls` | Empties the output, as **Clear** and **Ctrl+L** do.                                                                                                                                                                                                                                                 |
| `history`        | Lists the lines run in this workspace folder, numbered from 1.                                                                                                                                                                                                                                      |
| `!N`             | Runs line N of `history` again: `!5` runs the fifth.                                                                                                                                                                                                                                                |
| `last`           | Runs the last `tyto` command again: not one of these, and not a line with `&&`.                                                                                                                                                                                                                     |
| `exit`           | Closes this session, stopping what it runs.                                                                                                                                                                                                                                                         |
| `ls`             | Lists the panel's folder, or the folder named: `ls entregas`.                                                                                                                                                                                                                                       |
| `cd`             | Goes to a folder: `cd entregas/novembro`, `cd ..` back one. `cd` alone goes back to the top.                                                                                                                                                                                                        |
| `pwd`            | Prints the full path of the panel's folder.                                                                                                                                                                                                                                                         |
| `cat`            | Prints a text file: `cat notas.txt`. Up to 256 KB of it, with a line saying it was cut.                                                                                                                                                                                                             |
| `new`            | Makes an empty file: `new notas.txt`. `new cartaz.brief --template story` writes the template's skeleton, as **Delivery: New…** does. A brief or text file opens in a tab.                                                                                                                          |
| `mkdir`          | Makes a folder: `mkdir entrega-123`.                                                                                                                                                                                                                                                                |
| `mv`             | Moves or renames: `mv capa.brief entregas` puts it in `entregas`, `mv capa.brief nova.brief` renames it. Open tabs follow.                                                                                                                                                                          |
| `cp`             | Copies a file or a folder, as `mv` names its target.                                                                                                                                                                                                                                                |
| `rm`             | Moves files or folders to the bin: `rm velho.brief rascunhos`.                                                                                                                                                                                                                                      |
| `open`           | Opens a brief, recipe or text file in a tab.                                                                                                                                                                                                                                                        |
| `reveal`         | Selects a file or folder in the Explorer.                                                                                                                                                                                                                                                           |
| `alias`          | Lists the aliases, or saves one: `alias entrega='render --delivery'`. See [Aliases and variables](#aliases-and-variables).                                                                                                                                                                          |
| `unalias`        | Removes an alias: `unalias entrega`.                                                                                                                                                                                                                                                                |
| `set`            | Lists this session's variables, or sets one: `set brief=cartaz.brief`.                                                                                                                                                                                                                              |
| `templates`      | Lists the templates a render in the panel's folder can use, with where each comes from and its sizes: `tyto template list` run there. `templates entregas` lists another folder's; `--json` and `--trust` pass on to it. See [Templates](../command-line/templates.md#list-the-templates-in-reach). |

`ls` lists folders first, each ending in `/`, and every name beside its kind: folder, brief, recipe or file. A brief, a recipe or a text file is a link that opens it in a tab, unless its name has a space.

The file commands only reach inside the open workspace folder. A path that leaves it is refused: `..` above the folder, a path starting with `/`, `C:\`, `\\server` or `~`, and a link or junction that points outside it, which the [Explorer](workspace-folder.md#browse-its-files-the-explorer) does not show either. Each session has its own folder; opening another workspace folder sends every session back to the top. `cat` refuses a file that is not text.

Nothing is replaced: `mv`, `cp`, `new` and `mkdir` refuse a name that is already taken, and say so. `rm` never deletes for good: everything goes to the system's bin, where you can restore it. It asks first only when an open tab under what goes has unsaved changes, and it never removes the workspace folder itself. `cp` refuses a folder that holds a link or junction, and a folder never goes into itself.

## Several commands in one line

- `&&` runs the next command only if the one before ended with **✓ 0**: `check cartaz.brief && render cartaz.brief`. Each command is a block of its own. A command refused, stopped or ending with an error stops the line there. While a line runs, the session takes no other.
- `*` stands for any part of a name, and `?` for one character: `render *.brief` renders every brief of the open folder, and `render entregas/*.brief` those of `entregas`. A pattern looks only inside the open workspace folder and never goes through a `/`: `*` does not match a name starting with `.`, and there is no `**`. A pattern that leads outside the folder (`..`, `/`, `C:\`, `~`), or that matches no file, is refused and nothing in the line runs. Put a word in quotes to keep its `*` as it is.

## Aliases and variables

An alias is a short name for a line you type often. `alias entrega='render --delivery'` saves it, and from then on `entrega cartaz.brief` runs `render --delivery cartaz.brief`: the words after the name go after the alias's line.

- `alias` alone lists the aliases in force, each with where it is defined; `alias entrega` shows one. `unalias entrega` removes it.
- `alias` saves in your settings (`commandAliases` in `settings.json`), for every folder you open. `alias --workspace entrega='…'` saves it in the open folder's `.tyto/project.json` instead, under `aliases`, for everyone who opens that folder; `unalias --workspace entrega` removes it there. The panel never edits the folder's [work profile](workspace-folder.md#work-profiles): an alias only the profile defines is removed in the profile's own file. Comments and layout in the file stay as they were, and a file that does not parse is not written.
- **The folder's alias wins** over yours of the same name. A folder's aliases can also come from its [work profile](workspace-folder.md#work-profiles), the folder's own winning name by name.
- In a [restricted folder](workspace-folder.md#a-folder-you-have-not-trusted) the folder's aliases are withheld and never run: the strip above the editor counts them, and the Problems panel names them (`W_PROJECT_ALIASES_WITHHELD`). Yours still run, and `--workspace` is refused there.
- An alias expands once. Its line is taken as written: an alias inside it is not expanded again, and a `$` in it is just a character. Quote a line with spaces when you save it.
- An alias cannot take the name of the panel's own commands (`ls`, `cd`, `help`, `alias`…) nor `tyto`. One written by hand in a file with such a name is ignored, and the panel says so once.
- A line an alias made goes through the same refusals as a typed one. When it is refused, the line and the box say which alias it came from and where that alias is defined.

`set brief=cartaz.brief` sets a variable for this session, and `$brief` in a later line reads it: `render $brief`. `set` alone lists them. A variable lives until the session's tab closes, and each tab has its own.

- Only what `set` gave this session is read: `$HOME` and the other variables of your system are not, and a name never set refuses the line, running nothing.
- `$brief` is read anywhere in a word, and in double quotes: `"entregas/$brief"`. In single quotes it stays as typed: `'$brief'`.
- A value is always one word: spaces, quotes or `&&` in it are part of the word, never a new command.

## Complete as you type

A list right under the prompt shows what can come next, whichever order the runs are in:

- the commands, the panel's own among them, and then each command's options; after `&&`, the commands again;
- for `--template`, the templates and aliases the window knows;
- for `--formats`, the formats of the template already chosen;
- for `--types`, `png`, `jpeg`, `webp` and `svg`;
- for `plugin enable`, `disable` and `remove`, the installed plugins;
- for a brief, a folder or a file, and after `ls` and `cat`, what is in the panel's folder; after `cd`, its folders. A folder ends in `/` and the list goes on inside it.

**Tab** takes the first suggestion, or the only one. **↑** and **↓** choose one and **Enter** takes it. **Esc** closes the list. With nothing chosen, **Enter** runs the line as it is.

## History

**↑** and **↓** on the prompt go back through the lines run in this workspace folder. **Ctrl+R** searches them: type part of a line, press **Ctrl+R** again for an older match, **Enter** to run it, an arrow to keep it on the prompt and edit it, or **Esc** to go back. Each folder keeps its last 500 lines, on this computer only.

## The output

- Each run's header says how it ended: **✓ 0** in green when it worked, **✗** and the exit code in red when it did not.
- A line is coloured by what it says, not by where the command wrote it: a problem the command reports is red when it is an error and amber when it is a warning, with its code in bold, and the hint under it is grey. Anything else, such as a question the command asks or what `history` prints, is plain text. The panel's own messages, such as why it refused a line, are grey.
- A command that prints its own colours keeps them.
- A place a problem names, such as `cartaz.brief:5:1`, is a link, and so is any brief or text file of the open folder: **click** it to open the file in a tab, at that line.
- The same problems are listed in [Problems](panels.md#problems), under the command that reported them. The status bar counts them, as does the **PROBLEMS** tab.
- **Ctrl+F** finds in the output: **Enter** goes to the next match, **Shift+Enter** to the previous one, **Esc** closes.
- Select text to copy it with **Ctrl+C**. **Clear** (or **Ctrl+L**) empties the output. The last 3,000 lines are kept.

## Stop, and more than one at a time

While a command runs, the square **Stop** button shows; **Ctrl+C** on the prompt, with nothing selected, does the same. `render` and `watch` stop part of the way through. A command that cannot is marked _stopped_ at once and finishes on its own, and it gets no exit code. A `watch` goes on while the area is hidden.

The **+** button opens another session, so a `watch` can keep running while you type other commands. With two or more sessions, each shows as a small tab at the right of the strip, with the exit code of its last command. Closing a session stops what it runs. A session runs one command at a time.

## Render the brief in front

With a saved brief in front, **Commands: Render This Brief** in the command bar writes `render "<its path>"` on the prompt without running it. Add options, with completion's help, and press **Enter**. It is offered when the brief is in the open folder, or outside your user folder.
