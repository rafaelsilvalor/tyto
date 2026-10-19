# Images: PNG, JPEG and WebP

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `e3d32e9`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

Tick **PNG**, **JPEG** or **WEBP** in the Export dialog to get images. Which to pick:

| Type | Use it for                                                                           |
| ---- | ------------------------------------------------------------------------------------ |
| PNG  | The exact pixels, with no loss. The safe choice for posting and for printing proofs. |
| JPEG | Smaller files where a little loss does not show, such as photos.                     |
| WebP | Smaller still, for the web; some older programs cannot open it.                      |

Ticking more than one makes each image once per type, side by side: `grid-01.png` and `grid-01.jpg`.

## Scale

**Scale** appears once an image type is ticked, with two choices:

- **1×** — each artwork at the size its format declares, such as 1080 × 1350 for a grid post.
- **2×** — the same artwork at twice the pixels, 2160 × 2700: sharper on high-resolution screens and in print, with the same layout.

Scale changes the pixels, not the design. SVG files are not affected by it.

## Quality

**Quality** appears when JPEG or WebP is ticked: a number from 1 to 100, 90 unless you change it. Lower numbers make smaller files that lose more detail. PNG does not lose detail, so quality does not reach it; with only PNG ticked the field is not shown.

## When an image is not written

If something stops a file from being made, the dialog lists the reason under the progress bar and the Problems panel shows it too. One you may meet:

- `E_EXPORT_FONT_UNRESOLVED` naming an _italic_ font: text in `*italic*` cannot be exported with the fonts that come with Tyto, and no file is written for that artwork. Take the italic out of the brief to export it.

<!-- TYTO-329: italic fails at export. Measured on e3d32e9 with `::titulo Open day at the *library*`: no file written. -->
