# Workspace folder

::: info How this page was checked
Every step was followed on 2026-10-21 on a development build of Tyto on Windows 11, in a folder holding a `.tyto/project.json`, a template in `tpl/`, an image in `art/` and two briefs in `briefs/`, in a second folder whose `assets` led outside it, and on the same day in a folder naming a work profile kept in `~/.tyto/profiles/` and in one naming a profile file inside it whose `assets` led outside the profile's folder. Menus and labels below are the English window's. The Explorer's header buttons were checked on 2026-10-23 on a development build, in the light and the dark theme.
:::

A workspace folder is a project folder with a `.tyto/project.json` in it. The file says where the project keeps its templates, images and fonts, and where its exports go:

```jsonc
{
  "templates": ["tpl"],
  "assets": ["art"],
  "fonts": ["fonts"],
  "output": "exports",
}
```

Every key is optional, and so is the file: a folder without one opens with nothing declared. Paths are relative to the folder.

## Open and close it

**File ▸ Open Folder…** picks the folder. One folder is open per window, and it is open again the next time Tyto starts. **File ▸ Close Folder** closes it. While a folder is open, the title bar names it between the file and the app: `logo.brief — promo — Tyto`.

While it is open:

- its templates are offered beside yours and the built-in ones, after [your templates folder](../templates/templates-folder.md);
- a brief **inside the folder** finds images in its `assets` folders after its own folder and the `assets/` beside it, and draws with its `fonts` before the ones installed on this computer;
- **Export** points at its `output` folder until you choose another.

A brief outside the folder works as it always did.

## Browse its files: the Explorer

Opening a folder with **File ▸ Open Folder…** opens the **Explorer** in the left area, above the queue. It lists the folder's files and folders, folders first, and shows a folder's contents when you open it. A file made, renamed or deleted outside Tyto appears or goes away on its own, a moment later.

- **Click a brief** to open it in a tab, or select it and press **Enter**. A brief already open is its tab.
- **Click a folder**, or press **Right** and **Left**, to open and close it. **Up**, **Down**, **Home** and **End** move through the list.
- **Click an image** — a `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` or `.svg` — to see it in the preview, or select it and press **Enter**. The Explorer keeps the focus, so you can go on choosing; the preview tab is named after the file, and [the preview](./panels.md#an-image-from-the-explorer) shows its size.
- **Any other file** — a PDF, a font — is listed and does nothing when clicked. Tyto does not open files with other programs from the Explorer.
- A folder holding more than 2,000 entries shows the first 2,000 and a line saying how many more there are. `.git` is not listed.

Each entry has an icon for its type: a brief, an image, a font, a JSON file, a text file, a template folder and the `template.html`, `template.ts` and `manifest.yaml` in it, the project's own `.tyto/project.json`, and the app's `settings.json`, `keybindings.json` and `snippets.json`. A folder named `assets`, and the folders your `.tyto/project.json` names as `assets`, `templates` or `output`, get icons of their own. A file Tyto has no icon for gets a plain page. The tabs use the same icons.

### New, rename and delete

Right-click an entry for **New File…**, **New Folder…**, **Rename…** and **Delete**; right-click the empty space below the list for the two **New** items.

While a folder is open, the Explorer's header has three buttons beside its **×**: **New File…** and **New Folder…** open the same field as the menu, in the same place, and **Collapse All** closes every open folder, at every depth. There is no refresh button: the Explorer lists again on its own when the folder changes.

- **New File…** and **New Folder…** open a field in the tree: in the folder selected, in the folder of the file selected, or at the top of the folder when nothing is selected (or when you right-clicked the empty space). Type the name and press **Enter**. The name is used exactly as typed, extension or not; a new `.brief` opens in a tab, and any other file is only made.
- **Rename…**, or **F2** on the selected entry, turns its name into the same field. A brief open in a tab keeps its tab, which shows the new name; text you had not saved stays unsaved, and the next save writes to the new name.
- In the field, **Enter** or clicking elsewhere confirms and **Escape** cancels. A name that is taken, or that no file can have, keeps the field open with your text and a line under it saying why.
- **Delete**, or the **Delete** key on the selected entry, always asks first, and moves the file or the folder to the system's Recycle Bin (the Trash on macOS and Linux), where you can restore it. Tyto never deletes anything for good. If a tab has unsaved changes to a file in it, the question says so, and the text stays in the tab, which now belongs to no file. If the Recycle Bin refuses the entry — some network drives have none — nothing is deleted and the Explorer says so under the entry.

These work in every folder, trusted or not: none of them runs anything in it.

The **Explorer** button in the status bar, beside the queue's, shows and hides it, as does **Show or hide: Explorer** in the command bar. When Tyto starts again with the folder still open, the Explorer is as you left it: closed if you closed it. With no folder open it says _No folder open_ and offers **Open Folder…**. It lists an untrusted folder like any other: listing a folder runs nothing in it.

## A folder you have not trusted

Every folder starts untrusted. An untrusted folder still opens, previews and exports, but every folder its project file names must be inside it: a name that leads outside — `../shared`, an absolute path, or a shortcut inside the folder that points elsewhere — is left out. Each one left out is listed in the **Problems** panel as `W_PROJECT_PATH_OUTSIDE`, with its line and column in `.tyto/project.json`. Its plugin sections are withheld too.

When something was left out, a strip above the editor says so, with three buttons: **Trust this folder** trusts it and applies what was left out at once, **Show problems** opens the Problems panel, and **Show project** opens the Project panel (below). A folder whose names all stay inside it never shows the strip.

## Work profiles

A project file can name a **work profile**: a sheet of places many folders share, such as one vertical's images, templates, fonts and output folder. `"profile": "saude"` names one kept in your Tyto home folder, at `~/.tyto/profiles/saude/profile.json`; a path such as `"profile": "team/saude.json"` names one your team shares. The profile's places come first and the folder's own keys win, one key at a time. [Render a brief](../command-line/render.md#share-one-sheet-across-folders-work-profiles) shows how to write one.

A profile kept in your Tyto home folder is trusted where it lives and never asks. A profile named by its path is trusted on its own, never because the folder that names it is: until you trust it, its folders must stay inside its own folder. When it left something out, the strip above the editor has a line of its own for it, with **Trust this profile**, and its problems are listed in **Problems** with the profile's file in front, such as `team\saude.json:2:14`. A trusted folder can show the profile's line alone.

## See where each place came from

**Workspace: Show Project**, from the command bar, opens the **Project** panel beside Problems. It has one line each for `assets`, `templates`, `fonts` and `output`: the folders in force, and where they came from — `profile saude`, `this folder`, or `not set`. With no folder open it says _No folder open_. The strip's **Show project** button opens it too, but the strip only appears when an untrusted folder or profile left something out, so for a folder you trust the command is the way in.

## Manage trust

**Workspace: Manage Trust**, from the command bar, shows the open folder and whether it is trusted, with **Trust** and **Remove trust**, and the work profile it names with its own two buttons — none for a profile kept in your Tyto home folder. Removing trust applies the next time the folder is opened; until then it stays as it is.

The folders and profile files you trust are listed in `trust.json` in your Tyto home folder (`~/.tyto`). From the command line, `tyto trust remove <folder>` takes a trust back; [Render a brief](../command-line/render.md) has the rest.
