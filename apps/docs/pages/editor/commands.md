# Commands

::: info How this page was checked
Every step was followed on 2026-10-30 on a development build of Tyto from the branch that added this page, on Windows 11, in the English window. The Portuguese edition's labels were read from the window's own catalogue, not from a running window. The run blocks and the place of the suggestion list were checked again on 2026-10-31, once this page described them. The refusals of `tyto mcp`, `watch` and `recipe run --apply` were added to this list on 2026-11-12 from the window's code and its unit tests, the last one through the command line's own parser, not in the window. The panel's own commands, `&&`, `!N` and patterns were added on 2026-11-15 from the window's code and its unit tests, not in the window. The boxes a refusal offers were added on 2026-11-15: the ones for `--trust` and `recipe run --apply` were followed in the window, with both answers; the ones for `signin`, `signout` and `watch` come from the window's code and its unit tests.
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
- `|`, `>`, `;`, `$HOME` and `~` mean nothing here. They reach the command as words. `&&`, `!N`, `*` and `?` are read by the panel, as [Several commands in one line](#several-commands-in-one-line) says.
- The command runs in the open [workspace folder](workspace-folder.md), so a path can be written from there. With no folder open, it runs in your Tyto folder (`~/.tyto`).
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

These are not `tyto` commands: the panel answers them itself, and none of them writes a file, so they also run in a [restricted folder](workspace-folder.md). Writing `tyto` first sends the line to the command line instead: `tyto help` is its own help.

| Command          | What it does                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `help`           | Lists these commands and the `tyto` commands. `help render` shows the help of `tyto render`. |
| `clear` or `cls` | Empties the output, as **Clear** and **Ctrl+L** do.                                          |
| `history`        | Lists the lines run in this workspace folder, numbered from 1.                               |
| `!N`             | Runs line N of `history` again: `!5` runs the fifth.                                         |
| `last`           | Runs the last `tyto` command again: not one of these, and not a line with `&&`.              |
| `exit`           | Closes this session, stopping what it runs.                                                  |

## Several commands in one line

- `&&` runs the next command only if the one before ended with **✓ 0**: `check cartaz.brief && render cartaz.brief`. Each command is a block of its own. A command refused, stopped or ending with an error stops the line there. While a line runs, the session takes no other.
- `*` stands for any part of a name, and `?` for one character: `render *.brief` renders every brief of the open folder, and `render entregas/*.brief` those of `entregas`. A pattern looks only inside the open workspace folder and never goes through a `/`: `*` does not match a name starting with `.`, and there is no `**`. A pattern that leads outside the folder (`..`, `/`, `C:\`, `~`), or that matches no file, is refused and nothing in the line runs. Put a word in quotes to keep its `*` as it is.

## Complete as you type

A list right under the prompt shows what can come next, whichever order the runs are in:

- the commands, the panel's own among them, and then each command's options; after `&&`, the commands again;
- for `--template`, the templates and aliases the window knows;
- for `--formats`, the formats of the template already chosen;
- for `--types`, `png`, `jpeg`, `webp` and `svg`;
- for `plugin enable`, `disable` and `remove`, the installed plugins;
- for a brief, a folder or a file, what is in the open folder. A folder ends in `/` and the list goes on inside it.

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
