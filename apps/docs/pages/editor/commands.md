# Commands

::: info How this page was checked
Every step was followed on 2026-10-30 on a development build of Tyto from the branch that added this page, on Windows 11, in the English window. The Portuguese edition's labels were read from the window's own catalogue, not from a running window. The run blocks and the place of the suggestion list were checked again on 2026-10-31, once this page described them.
:::

The **Commands** tab of the bottom area runs `tyto` commands, the same ones as the [command line](../command-line/index.md), inside the window. Nothing else runs there: not a shell and not another program.

## Open it

- **Ctrl+`** opens the bottom area on Commands with the cursor on the prompt. It is the key left of **1**, whatever your keyboard prints on it: on a Brazilian keyboard that key prints an apostrophe. Pressed again while Commands is in front, it hides the area.
- **Commands: Run…** in the command bar does the same.
- Or click **COMMANDS** beside **PROBLEMS** at the top of the bottom area.

The bottom area shows one tab at a time. Its **×** hides the whole area, and everything in it is there when it comes back.

## Run a command

Type after `tyto ›` and press **Enter**. Writing `tyto` first is optional.

- Words are split on spaces. Put a path with spaces in quotes: `render "Meus briefs/cartaz.brief"`. A quote left open is refused and nothing runs.
- `|`, `>`, `&&`, `$HOME` and `*` mean nothing here. They reach the command as words.
- The command runs in the open [workspace folder](workspace-folder.md), so a path can be written from there. With no folder open, it runs in your Tyto folder (`~/.tyto`).
- Two things are refused, with a line saying why: `--trust`, because the window trusts a folder with **Workspace: Manage Trust**, and installing an npm package with `plugin install` on Windows, because that would start a shell.
- A command that needs an answer, such as approving a plugin's permissions, asks in a box of the window's own.

Each command you run is a block. Its header shows the command, with its paths cut to the file name (the whole line is the tooltip), the time it started and how it ended: **✓ 0** when it went well, **✗ 1** when the brief has errors, **✗ 2** when Tyto itself failed, **✗** alone for a line refused before it ran, `–` when stopped and `•` while it runs. What the command printed is under the header. Whether the newest run comes last or first, and whether older runs fold to their header, are two settings, described in [Panels](panels.md#commands).

## Complete as you type

A list right under the prompt shows what can come next, whichever order the runs are in:

- the commands, and then each command's options;
- for `--template`, the templates and aliases the window knows;
- for `--formats`, the formats of the template already chosen;
- for `--types`, `png`, `jpeg`, `webp` and `svg`;
- for `plugin enable`, `disable` and `remove`, the installed plugins;
- for a brief, a folder or a file, what is in the open folder. A folder ends in `/` and the list goes on inside it.

**Tab** takes the first suggestion, or the only one. **↑** and **↓** choose one and **Enter** takes it. **Esc** closes the list. With nothing chosen, **Enter** runs the line as it is.

## History

**↑** and **↓** on the prompt go back through the lines run in this workspace folder. **Ctrl+R** searches them: type part of a line, press **Ctrl+R** again for an older match, **Enter** to run it, an arrow to keep it on the prompt and edit it, or **Esc** to go back. Each folder keeps its last 500 lines, on this computer only.

## The output

- It keeps the colours a command prints, and errors are red.
- A place a problem names, such as `cartaz.brief:5:1`, is a link, and so is any brief or text file of the open folder: **click** it to open the file in a tab, at that line.
- The same problems are listed in [Problems](panels.md#problems), under the command that reported them. The status bar counts them, as does the **PROBLEMS** tab.
- **Ctrl+F** finds in the output: **Enter** goes to the next match, **Shift+Enter** to the previous one, **Esc** closes.
- Select text to copy it with **Ctrl+C**. **Clear** (or **Ctrl+L**) empties the output. The last 3,000 lines are kept.

## Stop, and more than one at a time

While a command runs, the square **Stop** button shows; **Ctrl+C** on the prompt, with nothing selected, does the same. `render` and `watch` stop part of the way through. A command that cannot is marked _stopped_ at once and finishes on its own, and it gets no exit code. A `watch` goes on while the area is hidden.

The **+** button opens another session, so a `watch` can keep running while you type other commands. With two or more sessions, each shows as a small tab at the right of the strip, with the exit code of its last command. Closing a session stops what it runs. A session runs one command at a time.

## Render the brief in front

With a saved brief in front, **Commands: Render This Brief** in the command bar writes `render "<its path>"` on the prompt without running it. Add options, with completion's help, and press **Enter**. It is offered when the brief is in the open folder, or outside your user folder.
