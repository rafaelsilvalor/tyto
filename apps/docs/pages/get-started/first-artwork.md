# Your first artwork

From an empty window to PNG files on disk, in six steps. You make a small template of your own, write a brief that fills it, watch the preview, fix one problem on purpose, and export.

::: info How this page was checked
Every step was followed on 2026-10-18 on a development build of Tyto 0.7.0 (commit `639ca82`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

Every step uses the **command bar**: press **Ctrl+K** (**Cmd+K** on macOS), type a few words of the command's name, check it is the first row, and press **Enter**. The [tour of the window](./window-tour.md) names the parts this page talks about.

## Before you start

The first time it opens, the window holds an **Untitled** tab with its preview beside it, and the problems panel already lists `E_NO_TEMPLATE`: an empty brief names no template yet. You can leave that tab alone.

Make an empty folder for your templates anywhere you like — for example `Tyto templates` in your Documents.

## 1. Choose the template folder

Run **Choose template folder…** and pick the folder you made. Tyto now looks for templates there.

The problems panel shows `E_TEMPLATE_FOLDER_EMPTY` (a warning: the folder has no templates yet). The next step fixes it.

## 2. Make a template

Run **New template…**. The window turns into **Editing template**, with a box at the top right for the name. Type `first-card` and press **Enter** (or **Create**).

Tyto writes a small starter template into `Tyto templates\first-card` and shows it: `manifest.yaml` and `template.html` on the left, and on the right its sample brief drawn in every format the template has — `grid`, `grid-1x1`, `story`, `banner` and two more. The starter's names are short Portuguese words: a slot called `titulo` (title), an image slot called `imagem`, and a colour choice called `tom` that takes `azul` (blue) or `laranja` (orange).

Click **Close**. The template is already in the folder: `E_TEMPLATE_FOLDER_EMPTY` is gone from the problems panel, and `first-card` is in the next step's list.

## 3. Write a brief

Run **New brief from template…**. The command bar lists every template with the folder it came from; type `first-card` and press **Enter**.

A new tab opens with the template's skeleton, and the word `titulo` after `::titulo` is selected:

```
---
template: first-card
formats: [grid, grid-1x1, story, banner, banner-1x1, banner-345x146]
---

::titulo titulo
```

Type your title over it — this page used `A reading list for autumn`.

## 4. Watch the preview

The preview beside the editor draws the brief as you type: dark blue, with your title in white. Its toolbar has one button per format; click **story** to see the tall version, **Fit** to fit it to the space.

## 5. Make a problem and fix it

Put the cursor at the end of the `formats:` line, press **Enter**, and type:

```
tom: verde
```

`verde` (green) is not one of the colours the template accepts. Within a moment:

- the problems panel lists `E_BAD_SLOT_VALUE` — `Slot 'tom' is invalid: 'verde' is not one of azul, laranja.` — at `4:1`;
- `tom` is underlined in the editor, and the status bar counts one problem;
- the preview keeps the last drawing that worked.

Click the problem: the cursor goes to line 4 and selects `tom`. Replace `verde` with `laranja`. The problem goes away and the preview turns orange.

## 6. Save and export

Press **Ctrl+S** (**Cmd+S**) and save the brief as `reading-list.brief`, in any folder. The tab and the title bar take the name.

Run **Export…** (or click the export button in the status bar). In the dialog:

1. **Destination folder ▸ Choose…** — pick an empty folder for the images.
2. **Formats** — leave every format ticked.
3. Click **Export**.

The dialog counts `6 / 6` and says **Export finished**; **Open folder** opens the destination. In it:

| File                    | Size        |
| ----------------------- | ----------- |
| `grid-01.png`           | 1080 × 1350 |
| `grid-1x1-01.png`       | 1080 × 1080 |
| `story-01.png`          | 1080 × 1920 |
| `banner-01.png`         | 1200 × 628  |
| `banner-1x1-01.png`     | 600 × 600   |
| `banner-345x146-01.png` | 345 × 146   |

and an `editaveis` folder holding a copy of the brief, `template.txt` (the template's name and version) and `result.json` (what the export wrote).

## Where to go next

- [Tour of the window](./window-tour.md) — the names of everything you just used.
- [Commands](../reference/commands.md) — every command the bar can run, and its key.
- To change how `first-card` looks, the guide for template authors is under [Extend](../extend/).
