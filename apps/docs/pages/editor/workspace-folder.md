# Workspace folder

::: info How this page was checked
Every step was followed on 2026-10-21 on a development build of Tyto on Windows 11, in a folder holding a `.tyto/project.json`, a template in `tpl/`, an image in `art/` and two briefs in `briefs/`, in a second folder whose `assets` led outside it, and on the same day in a folder naming a work profile kept in `~/.tyto/profiles/` and in one naming a profile file inside it whose `assets` led outside the profile's folder. Menus and labels below are the English window's. The Explorer's header buttons were checked on 2026-10-23 on a development build, in the light and the dark theme. Export presets were checked on 2026-10-23 on a development build, from the command bar and from a key bound in `keybindings.json`. **Delivery: New…** was checked on 2026-10-30 on a development build, with a name refused, a name accepted, **No template**, and a brief already there.
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

### Switching between recent folders

The title bar has a button after **Help** with the open folder's name, or _No folder_. Click it, or run **Open Recent Folder…** from the command bar or the **File** menu, to list the folders you opened before, newest first, with where each one is. Type to filter the list by name or place, move with the arrow keys and press **Enter** to open the highlighted folder; **Esc** closes the list. The open folder is listed and marked _open_. **Open Local Folder…** at the foot is **File ▸ Open Folder…**.

A folder chosen here opens exactly as **File ▸ Open Folder…** opens it: in the same window, replacing the folder open now, and trusted only if you trusted it before. The list keeps the last ten folders, and a folder that is no longer on disk is left out. `workspace.openRecent` is the command's id, so `keybindings.json` can put it on a key.

While it is open:

- its templates are offered beside yours and the built-in ones, after [your templates folder](../templates/templates-folder.md);
- a brief **inside the folder** finds images in its `assets` folders after its own folder and the `assets/` beside it, and draws with its `fonts` before the ones installed on this computer;
- **Export** points at its `output` folder until you choose another.

A brief outside the folder works as it always did.

## Export presets: a delivery with one key

A project file can name **export presets**: a set of sizes and file types, and the folder they go to, run as one command.

```jsonc
{
  "output": "exports",
  "exportPresets": {
    "entregas": { "formats": ["grid-1x1", "story"], "folder": "entregas" },
    "web": { "formats": ["story"], "types": ["webp", "png"] },
  },
}
```

- `formats` lists the sizes, at least one. A size the brief's template does not have is reported when the preset runs, as the Export dialog reports it.
- `types` lists the file types — `png`, `jpeg`, `webp`, `svg` — and is `png` when left out.
- `folder` is where the files go, relative to the open folder. Without it the preset uses `output`; with neither, the preset is left out and **Problems** says why. The folder is made if it is not there.

Each preset is a command in the command bar, **Export: entregas**, for the brief in front. It opens the Export dialog already running, with the count, the problems and **Open folder** as usual, and writes what [Export](../export/index.md#what-is-written) writes: a file the previous export put there and this one did not is removed and listed, and files of your own in the folder are never touched.

To give a preset a key, bind its command in [`keybindings.json`](../customize/keybindings-json.md):

```json
[{ "key": "ctrl+e", "command": "export.preset:entregas" }]
```

A work profile can hold presets too. A folder that defines a preset of the same name replaces that one and keeps the profile's others. A profile's `folder` is still relative to the open folder, so `"folder": "entregas"` is each campaign's own `entregas`. In a folder you have not trusted, a preset's `folder` must stay inside it: one that leads outside is listed as `W_PROJECT_PATH_OUTSIDE` and that preset is left out.

## Deliveries: one folder per piece of work

A **delivery** is a folder for one piece of work, named after its ticket, with `assets/` and `editaveis/` inside and the brief in `editaveis/`.

**File ▸ Delivery: New…**, or the same command from the command bar, makes one in the open folder. The command bar asks for its name, and says while you type why a name cannot be a folder's — a `:` or a `/`, say — so Enter does nothing until it can. Then it lists the templates, as **New brief from template…** does, with **No template** first. The delivery's brief opens in a new tab and is selected in the Explorer: with a template it holds the template's skeleton, and with none it opens with the "/" menu, where choosing a template writes its skeleton. A brief already there is never overwritten: the status bar says why nothing was made, and nothing is written. The command is greyed while no folder is open, and you can bind it in [`keybindings.json`](../customize/keybindings-json.md) as `delivery.new`. [`tyto delivery new`](../command-line/deliveries.md) does the same from the command line.

The `delivery` key says where and how, and every part of it is optional:

```jsonc
{
  "delivery": {
    "parent": "entregas", // where deliveries are made; the open folder when left out
    "folders": ["assets", "editaveis"], // made inside every new delivery
    "brief": "editaveis", // the folder the brief is kept in; "." is the delivery itself
    "exports": ".", // where its artwork is written
  },
}
```

The values shown for `folders`, `brief` and `exports` are what applies when the key is left out. `parent` is relative to the open folder; the other three are relative to the delivery and must stay inside it. `exports`, and `formats` and `types` (lists of sizes and file types), are for exporting a delivery, which this version does not do yet: they are read and checked, and nothing uses them.

A work profile can hold a `delivery` too, and a campaign is a work profile: the folder's own `delivery` overrides one part at a time, so a folder that writes only `"exports": "final"` keeps the profile's `folders`. A profile's `parent` is still relative to the open folder. A delivery always stays inside the open folder, trusted or not: a `parent` that leads outside is listed as `W_PROJECT_PATH_OUTSIDE` and the one before it applies. A part that is not accepted is listed in **Problems** and the one before it, or the one shown above, applies.

## Browse its files: the Explorer

Opening a folder with **File ▸ Open Folder…** opens the **Explorer** in the left area, above the queue. It lists the folder's files and folders, folders first, and shows a folder's contents when you open it. A file made, renamed or deleted outside Tyto appears or goes away on its own, a moment later.

- **Click a brief** to open it in a tab, or select it and press **Enter**. A brief already open is its tab.
- **Click a `.txt` or a `.md`** to open it in a tab too, as [a text file](./text-files.md).
- **Click a folder**, or press **Right** and **Left**, to open and close it. **Up**, **Down**, **Home** and **End** move through the list.
- **Click an image** — a `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` or `.svg` — to see it in the preview, or select it and press **Enter**. The Explorer keeps the focus, so you can go on choosing; the preview tab is named after the file, and [the preview](./panels.md#an-image-from-the-explorer) shows its size.
- **Any other file** — a PDF, a font, a `.json` — is listed and does nothing when clicked. Tyto does not open files with other programs from the Explorer.
- A folder holding more than 2,000 entries shows the first 2,000 and a line saying how many more there are. `.git` is not listed.

Each entry has an icon for its type: a brief, an image, a font, a JSON file, a text file, a template folder and the `template.html`, `template.ts` and `manifest.yaml` in it, the project's own `.tyto/project.json`, and the app's `settings.json`, `keybindings.json` and `snippets.json`. A folder named `assets`, and the folders your `.tyto/project.json` names as `assets`, `templates` or `output`, get icons of their own. A file Tyto has no icon for gets a plain page. The tabs use the same icons.

### New, rename and delete

Right-click an entry for **New File…**, **New Folder…**, **Rename…** and **Delete**; right-click the empty space below the list for the two **New** items. From the keyboard, **Shift+F10** or the **Menu** key opens the same menu under the selected entry; with no entry selected, it offers the two **New** items.

While a folder is open, the Explorer's header has three buttons beside its **×**: **New File…** and **New Folder…** open the same field as the menu, in the same place, and **Collapse All** closes every open folder, at every depth. There is no refresh button: the Explorer lists again on its own when the folder changes.

- **New File…** and **New Folder…** open a field in the tree: in the folder selected, in the folder of the file selected, or at the top of the folder when nothing is selected (or when you right-clicked the empty space). Type the name and press **Enter**. The name is used exactly as typed, extension or not; a new `.brief`, `.txt` or `.md` opens in a tab, and any other file is only made.
- **Rename…**, or **F2** on the selected entry, turns its name into the same field. A brief open in a tab keeps its tab, which shows the new name; text you had not saved stays unsaved, and the next save writes to the new name.
- In the field, **Enter** or clicking elsewhere confirms and **Escape** cancels. A name that is taken, or that no file can have, keeps the field open with your text and a line under it saying why.
- **Delete**, or the **Delete** key on the selected entry, always asks first, and moves the file or the folder to the system's Recycle Bin (the Trash on macOS and Linux), where you can restore it. Tyto never deletes anything for good. If a tab has unsaved changes to a file in it, the question says so, and the text stays in the tab, which now belongs to no file. If the Recycle Bin refuses the entry — some network drives have none — nothing is deleted and the Explorer says so under the entry.

These work in every folder, trusted or not: none of them runs anything in it.

The **Explorer** button in the status bar, beside the queue's, shows and hides it, as does **Show or hide: Explorer** in the command bar. When Tyto starts again with the folder still open, the Explorer is as you left it: closed if you closed it. With no folder open it says _No folder open_ and offers **Open Folder…**. It lists an untrusted folder like any other: listing a folder runs nothing in it.

## What a plugin reads from the folder

An installed plugin can have a key of its own under `plugins`, named by the plugin's id. It is where the folder tells that plugin what this project uses — which site to read, which sheet to fill — and it wins over the plugin's settings in `settings.json`, which are yours and the same in every folder:

```jsonc
{
  "plugins": {
    "my-connector": { "site": "acme.example", "limit": 50 },
  },
}
```

The plugin reads its own key each time it is asked for something, so an edit counts from the next request. **It never sees another plugin's key**, and while the folder is untrusted it sees none. Tyto does not check what is inside: the plugin says when something is wrong. **Never put a password or a token here**: the file is plain text that you copy and share. A plugin that needs one asks for it and keeps it in the system's secure storage.

From the command line, `--section` sets one key for one run without editing the file, and works in an untrusted folder too — see [Render a brief](../command-line/render.md#other-options).

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
