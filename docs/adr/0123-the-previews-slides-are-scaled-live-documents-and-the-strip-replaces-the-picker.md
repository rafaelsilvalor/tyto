# 0123 — The preview's slides are scaled live documents, and the strip replaces the picker

Status: accepted · 2026-10-23 · TYTO-323 · amends ADR 0084 (decisions 5 and 9)

## Context

The preview showed one slide at a time, and a carousel's slide was chosen from a `<select>` in
the preview's bar (ADR 0084 decision 5). Rafael asked on 2026-10-18 for more ways to look at a
brief's slides, including all of them at once, and widened the card on 2026-10-23: the one-slide
view must not pick its slide from a dropdown. It becomes a row of thumbnails, and clicking one
puts that slide in the main view. Problems that only show side by side — a title that wraps on
slide 3 alone, a colour that changes between slides — are what a carousel's author is looking for.

The card lands in two pull requests. This one is the shared thumbnails and the strip, with the
dropdown removed. The second adds the All slides grid, its two commands, and the mode kept in the
session. This record covers the first; the second extends it.

Every `brief:preview` answer already carries the HTML document of every slide in every format
(`frames`). The template-mode grid (`template-mode.ts`) already draws several of them at once as
scaled iframes, through `cellScale` and the `frameDocument` directive.

## Decision

1. **A thumbnail is the slide's live HTML document, scaled.** The same document the stage shows,
   in a sandboxed iframe laid out at the format's own size and scaled by a transform, as the
   template-mode grid draws its cells. No new IPC and no extra work in main: the frames are
   already in the document's state.
2. **One element draws them, `<tyto-slide-thumbnails>`** (`src/renderer/slide-thumbnails.ts`):
   light DOM, Lit `repeat` keyed by `artwork|format`. It takes a generic list — `{ id, label,
html, width, height }` — and not the preview's `Frame`, so a later strip of anything that is
   an HTML document of a known size (images in the preview, TYTO-366) can reuse it, and the All
   slides grid of the second pull request draws the same element.
3. **Every document goes in through `showDocument`**, via `frameDocument`: no iframe in it gets a
   `srcdoc` any other way, which keeps TYTO-219's first-of-two-`srcdoc` race out. Because
   `showDocument` does nothing for the document already showing, a keystroke on slide 3
   re-navigates thumbnail 3 alone. The thumbnails ride the preview's existing 200 ms debounce:
   they are repainted from the same answer, not asked for.
4. **Only a thumbnail on screen is given a document.** An `IntersectionObserver` rooted on the row
   says which are; one scrolled away keeps what it last showed and is given the new one when it
   is seen again. A 20-slide brief therefore starts as many navigations as fit in the row. **A
   new thumbnail is measured at once**, against the row's box, because the observer's first
   report waits for a rendering step: in the end-to-end suite's window the first thumbnail of a
   20-slide brief loaded 663 ms after it was inserted, against 4 ms for the stage's frame, and
   with the measure the last visible one loads in a median of 106 ms (12 runs). The observer
   owns every change after that: a scroll, a resize, the strip shown again.
5. **The strip sits under the stage**, every slide of the selected format in the brief's order,
   each **96 px tall** with the width following the format, labelled with its **number only**.
   It scrolls sideways when it does not fit. A slide with no frame in the selected format has no
   thumbnail, and the others keep their numbers. A brief with one slide has no strip, for the
   reason the picker hid itself: one slide is not a choice.
6. **Choosing.** A click on a thumbnail does what the picker's `change` did: it sets the
   document's `selection.artwork` and reveals the `::lamina` that made it in the editor. With the
   strip focused, **←**/**→** and **Home**/**End** move the selection, with a roving tabindex,
   and the focus follows the selection back into the strip after the editor is revealed.
   `preview.nextSlide` and `preview.previousSlide` stay.
7. **A slide that went clamps to the last one left.** `keepSelection` takes the artwork list the
   selection was made in, and a selected slide past the new end — the last `::lamina` deleted
   while it was shown — lands on the new last slide rather than back on slide 1.
8. **The strip can be hidden, per preview tab.** A button in the bar, filled while the strip
   shows, toggles `stripHidden` on the tab (`toggleStrip` in `editor-groups.ts`). It is kept in
   the session as an optional `stripHidden: true` on the preview's record — following or locked —
   on both sides of `session:write`/`session:read` and in `session.json`, with the version still
   1. A record from before it reads as shown. Locking or unlocking a preview keeps it. This
      amends ADR 0084 decision 9; the mode of the second pull request is meant to be kept the same
      way.
9. **The picker is gone**: the `<select>`, the `preview.slide.label` key and `paintArtworkList`.
   Three keys arrive, in both locales: `preview.strip.hide` and `preview.strip.show`, the
   button's tooltip and accessible name, which say what a press does and so change with the state
   ("Hide the slide strip" while it shows, "Show the slide strip" while it is hidden; Rafael,
   2026-10-23), and `preview.strip.label`, the strip's. Because the label changes, the button has
   no `aria-pressed`: a screen reader would announce "Hide the slide strip, pressed", the action
   and its opposite at once. The fill still marks the strip as shown. This amends ADR 0084 decision 5: the
   bar holds formats, the strip's toggle, zoom and Lock.

## Rejected

- **Raster thumbnails** (a PNG per slide, rendered by main). Every keystroke would cost one
  Chromium render per slide in main, the work the preview avoided by drawing the HTML it already
  has, and the bytes would cross the bridge for a picture the window can draw itself. A 20-slide
  brief would be 20 renders per change instead of none.
- **SVG thumbnails** (the SVG exporter's output). A second exporter on every keystroke, and a
  second drawing of the slide that is not the one on the stage: a thumbnail that could disagree
  with the slide it stands for would defeat the point of looking at them side by side.
- **A third mode, All formats** (the same slide in every format side by side). The format tabs
  and the template-mode grid already show a slide in each format, and the card lets it become a
  card of its own. It is not built here.

## Consequences

- A carousel's slides are visible at once under the one being edited, and a slide is one click
  or one key away, in both themes.
- The strip costs as many live documents as fit in the row, not as many as there are slides;
  the time to first paint of a 20-slide brief is measured in `e2e/preview-strip.desktop.test.ts`
  and printed for the pull request.
- The stage is shorter by the strip's height, so `fit` fits a smaller box while the strip shows;
  hiding the strip gives the room back.
- The manual's screenshots still show the picker until the second pull request's scenes.

## Updates

- **2026-10-23, the second pull request (TYTO-323):** All slides mode is the same
  `<tyto-slide-thumbnails>` with `layout: 'grid'`, not a second element: the two modes share one
  set of iframes, so a keystroke on slide 3 re-navigates one document whichever mode is on, and a
  mode switch navigates none. The grid takes the stage's room, wraps the slides in order and draws
  them at the height and column count `gridThumbnailLayout` picks so all of them fit, rows
  filling from the left (never past 1:1, never under
  64 px, where it scrolls down); a click or Enter on a slide opens it in One slide mode and
  reveals its `::lamina`, the arrows only choose. The bar gains two segmented buttons, **One
  slide** and **All slides** (`preview.mode.one`, `preview.mode.all`, with `aria-pressed`), and
  the commands `preview.showOneSlide` and `preview.showAllSlides`, with no default key. The mode is
  per tab, kept as an optional `mode: 'all'` on the preview's session record next to
  `stripHidden`, version still 1; a record without it, or with a value this version does not
  know, reads as One slide. In All slides the strip's toggle and the zoom are hidden, the strip's
  flag is kept for One slide, the stage keeps only the stale marker, and a brief of one slide
  shows it large whatever the mode. The manual's scenes `preview-strip` and `preview-all-slides`
  are added and `window-tour` retaken, so the picker is out of the pictures.
- **2026-10-23, same pull request, after review:** a thumbnail's document is drawn 1 CSS px past
  its paper on the right and bottom (`THUMBNAIL_BLEED`), clipped by it. At 125 % the paper's
  light background is snapped out to a device pixel the transformed document did not reach, which
  showed as a 1 px light line on a thumbnail's edge. The grid is a CSS grid of
  `gridThumbnailLayout`'s column count, so a short last row starts under slide 1.
