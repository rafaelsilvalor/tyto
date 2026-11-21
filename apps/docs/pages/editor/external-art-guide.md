# Guides for external art

::: info How this page was checked
Checked on 2026-11-20 on a development build of Tyto on Windows 11, with the built-in `arte-teste` template and a fresh folder the window had not trusted, by driving the window as `e2e/art-guide.desktop.test.ts` does: the command, the checkboxes, Insert the line and its undo, Save the brief first, the written guide shown in its folder, and the painted PNG drawn in the preview. The "opened" and "no program" answers and the box before writing over a guide were read in the code, not run. Labels are the English window's.
:::

Some templates leave a picture to be painted in another program, such as a background or an illustration under the title. Until that picture exists, the preview draws an outlined magenta box where it goes, and the Problems panel says `W_EXTERNAL_ART_MISSING`. A **guide** is a layered PSD at the picture's exact size, written beside the file the brief cites, so whoever paints it opens the guide, paints, and saves the PNG under the name the brief reads back.

The command line writes the same guides with [`tyto guide`](../command-line/render.md#write-each-guide-beside-its-art-tyto-guide); this page is the window's way.

## Write the guides

1. Open the brief, then press **Ctrl+K** and run **Generate Guide for External Art**.
2. The dialog lists one row per guide: the slot, the guide file and the art to save from it, each path relative to the brief's folder. A guide that is not there yet is **checked**; one that is already there is **unchecked**, since it may hold paint.
3. Check the guides you want and press **Write guides**.

For example, a brief that says `fundo: grafico.png` and renders one format lists `assets\grafico.guide.psd`, and the art to save is `assets\grafico.png`. With several formats there is one row per format: `grafico.grid-1x1.guide.psd`, `grafico.story.guide.psd`, and the art `grafico.grid-1x1.png`, `grafico.story.png`.

Under the list, after writing, the dialog says which files it wrote and how they reached you:

- **Opened in the program that opens a PSD on this computer.** Each guide opens in that program.
- **No program opens a PSD on this computer**: the guide is shown selected in its folder instead.
- **This folder is not trusted**: the guide is written and shown in its folder, never opened. A folder you have not trusted does not get to start a program by writing a file; [Workspace folder](./workspace-folder.md) says how to trust one.

## Save the painting where the brief reads it

Save the picture painted from the guide under the name in the **Art to save** column. The preview draws it as soon as the file is saved, with no keystroke and no change to the brief.

## Cite the PSD itself

With a plugin installed that decodes PSD files, the brief can cite the PSD instead of a PNG saved from it: `fundo: grafico.psd` draws the whole file, and `fundo: grafico.psd#arte` the layer named `arte` (a layer in a group is `grupo/arte`). Saving the PSD again redraws the preview, with no keystroke. With no such plugin installed, the Problems panel says `E_ASSET_DECODER_MISSING` on the brief's line. In a folder you have not trusted, no plugin decodes anything new: a picture decoded before still shows, and a new one asks you to trust the folder with **Workspace: Manage Trust**.

## A brief with unsaved edits

A guide is drawn from the brief's file, not from what is typed. When the brief has edits that are not saved, **Write guides** first asks **Save the brief first?**. **Save and write** saves it and writes the guides; **Cancel** writes nothing, and the dialog says so.

## Art the brief names no file for

A guide is named after the file the brief cites, so a slot the brief names no file for gets no guide. The dialog lists such slots under **Art the brief names no file for**, with the line that would cite one, for example `imagem: imagem.png`. **Insert the line** puts it into the brief (between the two `---`, or at the end for a block) as one change that **Ctrl+Z** takes back, and the slot's guide appears in the list, checked. The brief now has unsaved edits, so writing asks to save it first.

Citations that cannot get a guide, such as an item from a plugin's source or a second background, are listed under **Citations that get no guide**, with their line and the reason.

## A guide changed after the brief

A guide saved after the brief may hold what somebody painted in it. Checking one and pressing **Write guides** asks **Write over guides changed after the brief?** first; **Keep them**, the default, writes nothing.

## A template with no external art

When the brief's template declares no picture painted elsewhere, the dialog says so and names the template, and there is nothing to write.
