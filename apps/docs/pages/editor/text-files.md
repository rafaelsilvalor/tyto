# Text and Markdown files

::: info How this page was checked
Every step was followed on 2026-10-24 on a development build of Tyto on Windows 11, in a folder holding a `.brief`, a `.txt` and a `.md`, in the light and the dark theme. Menus and labels below are the English window's.
:::

Tyto opens and edits plain text files (`.txt`) and Markdown files (`.md`) in a tab, beside your briefs: notes for a campaign, a list of copy to check, a README. **Tyto does not make artwork from them.** Only a `.brief` is previewed and exported.

## Open one

- **From the Explorer**: click a `.txt` or a `.md`, or select it and press **Enter**. It opens in a tab, as a brief does. A file already open is its tab.
- **From the File menu**: **Open a brief…** (**Ctrl+O**) lists briefs first. Choose **Text files** in the dialog's file type list to see `.txt` and `.md` files, or **All supported files** to see the three kinds together.
- **A new one**: in the Explorer, **New File…** with a name ending in `.txt` or `.md` makes the file and opens it in a tab.

Other files, such as `.json`, `.csv` or `.yaml`, still do nothing when clicked in the Explorer.

## What a text tab does

A text tab is for writing, and the rest of the window steps aside:

- The status bar names the kind: **Plain text** for a `.txt`, **Markdown** for a `.md`.
- The **Problems** panel says _Text files are not checked._ Nothing in Tyto reads the text for mistakes.
- There is no preview, no **Export**, no export presets, and no zoom, size or slide commands. The command bar does not list them while a text tab is in front.
- The text is in the editor's own font, with no brief colours.

Saving, the dot that marks unsaved changes and closing work as they do for a brief. **Save as…** offers the tab's own extension, so a `.md` is saved as a `.md`. When Tyto starts again, the tab comes back with any text you had not saved.

A tab keeps its kind while it stays open. If you rename `notas.brief` to `notas.md` in the Explorer, the open tab is still a brief until you close it and open the file again.
