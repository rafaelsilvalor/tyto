# The command bar and search

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `e3d32e9`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

## Run a command

<Screenshot
  scene="command-bar-open"
  alt="The command bar open over the editor, listing commands with their keys."
/>

1. Press **Ctrl+K** (**Cmd+K** on macOS), or click the button at the left end of the status bar.
2. Type a few letters of what you want — `vim`, `split`, `theme`. The list narrows as you type, and shows each command's key beside it.
3. Press **Enter** to run the highlighted command, or **Escape** to close the bar.

Besides the commands, the bar lists the files you opened recently, each starting with **Recent:** — type part of a file's name to reopen it. Every command is in [Commands](../reference/commands.md), with the id that `keybindings.json` uses to put it on another key.

## Find and replace in a brief

**Find** (**Ctrl+F**) opens a search bar under the editor:

- type the text and press **Enter**, or use **next** and **previous**; **all** selects every match;
- **match case**, **regexp** and **by word** narrow what counts as a match;
- the second field and **replace** / **replace all** change what was found.

**Find: next** (**Ctrl+G**) and **Find: previous** (**Ctrl+Shift+G**) keep going without the bar. **Escape** closes it.

Find searches the file in front, not every open file.

## Go to a line or a block

- **Go to line** (**Ctrl+Alt+G**) asks for a line number and goes there.
- **Go to Block…** (**Ctrl+Shift+O**) lists the brief's parts — `header` for the frontmatter, then each `::` block with its first words. Type to narrow the list and press **Enter** to go to one.

The breadcrumb under the tab row always says which block the cursor is in.
