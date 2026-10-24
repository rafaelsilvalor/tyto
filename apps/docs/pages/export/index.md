# Export

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `e3d32e9`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

Exporting turns the brief in front into files: PNG, JPEG or WebP images, SVG drawings, or several at once.

## Export a brief

<Screenshot
  scene="export-dialog"
  alt="The Export dialog over a brief: a destination folder, the file types PNG, JPEG, WEBP and SVG with PNG ticked, the brief's formats ticked, and the Export and Close buttons."
/>

1. With the brief in front, run **Export…**: from the **File** menu, the export button in the status bar, or the command bar.
2. Under **Destination folder**, click **Choose…** and pick where the files go. The dialog remembers the folder until the window closes.
3. Under **File types**, tick the kinds you want; the first export starts with **PNG** alone. Each one ticked is a file per artwork and size.
4. Under **Formats**, untick the sizes you do not want. When the brief has a `formats:` line, the list shows only the sizes on it.
5. Click **Export**. A bar counts the files as they are written — **9 / 24** — and **Cancel** stops the run; the files already written stay.
6. When it says **Export finished**, **Open folder** shows the files.

**Scale** and **Quality** appear once an image type is ticked; [Images](./images.md) explains them.

## What is written

Each file is named after its size and the artwork's number: `grid-01.png`, `grid-02.png`, `story-01.png` and so on, so a carousel of four makes four of each.

Beside them, an `editaveis` folder (_editable_, in Portuguese) keeps what is needed to make the same files again: a copy of the brief, a `template.txt` naming the template and its version, and a `result.json` listing every file written.

## Export with a preset

When the open [workspace folder](../editor/workspace-folder.md#export-presets-a-delivery-with-one-key) names export presets, each is a command such as **Export: entregas**: it exports the brief in front with the preset's sizes and file types into its folder, with no choices to make, and shows the run in the same dialog. A preset can have its own key in `keybindings.json`.

## In this section

- [Images](./images.md) — PNG, JPEG and WebP; scale and quality.
- [SVG](./svg.md) — drawings that stay sharp at any size.
- [The queue folder](./queue-folder.md) — let other programs drop briefs to be rendered.

From a terminal, `tyto render` exports the same way; see [Command line](../command-line/).
