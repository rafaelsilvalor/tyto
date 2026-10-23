# Panels

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `e3d32e9`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's. The section on an image from the Explorer was followed on 2026-10-23 on a development build, in the English window, in the light and the dark theme.
:::

Panels sit in three **areas** around the editor groups: left, right and bottom. Tyto's own are the **Explorer**, **Problems**, **Project** and the **local queue**, and a plugin can add its own. The preview is not a panel: it is a tab, and has its own section below.

## Show and hide

- The buttons at the two ends of the status bar show and hide a whole area: **Show or hide the left area** on the left, **Show or hide the bottom area** on the right. The same commands are in the command bar, with one for the right area.
- The problems count in the status bar shows and hides **Problems**; the queue button beside it does the same for the **local queue**, as does **Show the local queue** in the command bar.
- The **×** at the right of a panel's header hides it.
- **Restore the default layout** puts every panel back where Tyto first had it: Problems open in the bottom area, the queue closed.

## Problems

<Screenshot
  scene="problems-panel"
  alt="A brief with an unknown block, underlined in the editor, and the Problems panel below naming it with its code and line."
/>

Problems lists what is wrong with the brief in front: each line has a **code** such as `E_UNKNOWN_SLOT`, a sentence saying what is wrong, and the line and column. **Click a line** to go there: the cursor lands on the text the problem is about, already selected. The same text is underlined in the editor, and the status bar counts the problems.

A brief with no problems says so instead of leaving the panel empty. The codes you meet most while writing are explained in [Briefs](../briefs/index.md#when-something-is-wrong).

<!-- TYTO-322: with settings.json in front the panel still says "about this brief"; it means the file in front. -->

## Explorer

The Explorer lists the files of the open [workspace folder](workspace-folder.md#browse-its-files-the-explorer) in the left area, above the queue. Opening a folder opens it, and clicking a brief in it opens the brief in a tab. Right-click an entry (or press **Shift+F10** or the **Menu** key on it), or press **F2** or **Delete** on it, to [make, rename or delete](workspace-folder.md#new-rename-and-delete) files and folders; a delete asks first and goes to the Recycle Bin. The buttons in its header, beside the **×**, are **New File…**, **New Folder…** and **Collapse All**.

## The local queue

The queue renders briefs that other programs drop into a folder. It opens in the left area; [The queue folder](../export/queue-folder.md) explains how to set it up and what it writes.

## Preview

The preview draws the brief as you type. **Open preview to the side** (**Ctrl+Shift+V**, or the button at the right end of a group's tab row) opens it in a group of its own; **Open preview** opens it as a tab in the group you are in.

Its toolbar has:

- one chip for each format the brief asks for — click one to see that size;
- **One slide** and **All slides**, the preview's two modes, for a carousel;
- a button that hides or shows the slide strip, in One slide;
- **−**, the zoom, **+** and **Fit**, which fits the artwork to the space;
- **Lock**. The preview normally follows the brief in front; locked, it stays on the brief it shows while you switch tabs, and its tab says so. **Toggle preview lock** does the same from the command bar.

Under a carousel's artwork is the **slide strip**: every slide in the chosen format, small and numbered from 1. Click one to show it above — the editor jumps to the `::lamina` that made it — or, with the strip focused, move with **←**, **→**, **Home** and **End**. The strip scrolls sideways when the slides do not fit, and each preview tab remembers whether you hid it.

<Screenshot
  scene="preview-strip"
  alt="A carousel of six slides in the preview: the first slide large, and under it the slide strip with all six, numbered 1 to 6, the first one marked."
/>

**All slides** shows every slide in the chosen format at once, in a grid, in order and numbered, each scaled so they all fit the preview. It is where a title that wraps on one slide only, or a colour that changes between slides, shows up. **Click a slide** to open it: the preview goes back to One slide with that slide large, and the editor jumps to its `::lamina`. The grid scrolls down only when there are too many slides to fit at a readable size.

<Screenshot
  scene="preview-all-slides"
  alt="The same carousel in All slides: the six slides in two rows of three, numbered 1 to 6, with All slides pressed in the preview's toolbar."
/>

Each preview tab remembers its mode, also after the window is reloaded or Tyto is closed and opened again. **Preview: show all slides** and **Preview: show one slide** switch it from the command bar. A brief with one slide has no modes: it is always shown large.

While the brief has an error the preview keeps the last drawing that worked, and the Problems panel says what to fix.

### An image from the Explorer

Clicking an image in the [Explorer](./workspace-folder.md#browse-its-files-the-explorer) shows it in the following preview, or opens one the way **Open preview** does. Its toolbar says the file's name, its size in pixels and its size on disk — _logo.png · 1200 × 630 px · 84 KB_ — in place of the formats; an SVG that gives no size of its own is shown at its `viewBox` and marked _scalable_. Zoom, **Fit** and **Lock** work as for a brief, and **Fit** never enlarges an image past its own size.

Bringing a brief's tab to the front makes the following preview show that brief again; a locked preview keeps the image. An image changed on disk is shown again; one deleted or moved out of the folder gives a following preview back to the brief, and a locked one says _This file is no longer in the folder._ An image over 32 MB is not loaded, and a file whose contents are not the image its name says is not shown; the preview says which. An SVG is shown as a picture: its scripts do not run and it loads nothing from the internet. A locked image preview is not brought back when Tyto starts again.
