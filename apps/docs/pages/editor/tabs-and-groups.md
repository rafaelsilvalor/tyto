# Tabs and editor groups

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `e3d32e9`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

Each open file is a **tab**. A row of tabs and the file in front of it is an **editor group**; the window starts with one group for your brief and one for its preview.

## Open, switch and close

- **New brief** (**Ctrl+N**) opens an empty brief, and **Open a brief…** (**Ctrl+O**) opens one from disk. Both are also in the **File** menu.
- Click a tab to bring it to the front. **Ctrl+PageDown** and **Ctrl+PageUp** go to the next and previous tab, and **Ctrl+1** to **Ctrl+9** go straight to a tab by its place in the row.
- Close a tab with its **×** or **Close the tab** (**Ctrl+W**). A tab with changes not yet saved shows a dot after its name, and closing it asks first: **Cancel** keeps it open, **Close without saving** drops the changes.

## Reopen a file you closed

There is no command that brings back the last closed tab. The files you opened recently are in the command bar instead: press **Ctrl+K**, type part of the file's name, and pick the line that starts with **Recent:**.

## Split

**Split editor right** (**Ctrl+\\**) and **Split editor down** (**Ctrl+Shift+\\**) make a new group beside or below the one you are in, showing the same file. Both groups show the same text: what you type in one appears in the other, so you can look at the top of a long brief while you write at the bottom.

Move between groups with **Focus next editor group** (**Ctrl+Alt+Right**) and **Focus previous editor group** (**Ctrl+Alt+Left**). Drag the line between two groups to change how much room each one has.

The button at the right end of a group's tab row is **Open preview to the side**: it opens the brief's preview in a group of its own. [Panels](./panels.md#preview) says more about the preview.

## Move a tab

- **Drag** a tab along its row to change its place, or onto another editor group's row to move it there. A brief's tab does not go into the group that holds a preview.
- **Move tab left** (**Ctrl+Shift+PageUp**) and **Move tab right** (**Ctrl+Shift+PageDown**) do the same with the keyboard.
- **Move tab to next editor group** sends the tab in front to the next group.

## Close a group

**Close editor group** closes the group you are in **and the tabs in it**: a file open only in that group is closed, and one with unsaved changes asks first, as closing its tab would. The other groups widen to fill the room.

The split commands, the moves and **Close editor group** are also in the **View** menu.

## What the window remembers

When the window closes, it keeps the files that were open, the groups they were in and where the panels were, and gives them back the next time it opens.
