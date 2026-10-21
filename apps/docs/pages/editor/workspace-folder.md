# Workspace folder

::: info How this page was checked
Every step was followed on 2026-10-21 on a development build of Tyto on Windows 11, in a folder holding a `.tyto/project.json`, a template in `tpl/`, an image in `art/` and two briefs in `briefs/`. Menus and labels below are the English window's.
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

**File ▸ Open Folder…** picks the folder. One folder is open per window, and it is open again the next time Tyto starts. **File ▸ Close Folder** closes it.

While it is open:

- its templates are offered beside yours and the built-in ones, after [your templates folder](../templates/templates-folder.md);
- a brief **inside the folder** finds images in its `assets` folders after its own folder and the `assets/` beside it, and draws with its `fonts` before the ones installed on this computer;
- **Export** points at its `output` folder until you choose another.

A brief outside the folder works as it always did.

## A folder you have not trusted

Every folder starts untrusted. An untrusted folder still opens, previews and exports, but every folder its project file names must be inside it: a name that leads outside — `../shared`, an absolute path, or a shortcut inside the folder that points elsewhere — is left out. Each one left out is listed in the **Problems** panel as `W_PROJECT_PATH_OUTSIDE`, with its line and column in `.tyto/project.json`.

The folders you trust are listed in `trust.json` in your Tyto home folder (`~/.tyto`). From the command line, `tyto trust remove <folder>` takes a trust back; [Render a brief](../command-line/render.md) has the rest.
