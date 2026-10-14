# 0085 — Every pane is a tab strip and a header row

Status: accepted · 2026-10-14 · TYTO-288 (first of three pull requests) · amends ADR 0024 (the
BRIEF header), decision 3 of ADR 0083 and decision 5 of ADR 0084

## Context

Rafael asked on 2026-10-13 for a better finish on the tabs, "fitting and aligned with every
pane", pointing at Zed: a tab with the file name on top of its pane, and right under it a thin
row with the location and the pane's actions (TYTO-288). Read at `origin/main` on 2026-10-14
(`1cc9e8e`), the window had four shapes for the top of a pane:

- each editor group drew its tab strip with "Open preview to the side" at the end of it
  (ADR 0083 decision 3, ADR 0084 decision 7);
- over all the groups, the editor panel drew a bar of its own — the heading "BRIEF" and the
  template picker (E9.3, ADR 0024);
- a preview drew its `.preview__bar` of formats, slide, zoom and Lock, which ADR 0084 decision 5
  left plain for this card;
- every docked panel — Problems, the queue, a plugin's — drew a `.work__bar` with an upper-case
  heading and a close button, in `flex-wrap: wrap`, so its height was whatever its contents made
  it.

None of the four was the height of another, so the tops of the editor, the preview and the
panels did not line up, which is what the screenshot on the card shows. The card ships in three
pull requests: this one is the shape; the folder on hover (ADR 0086) and dragging a tab are the
next two.

## Decision

1. **Every pane is two lines, then its content.** A tab strip (`.pane__strip`) and, under it, a
   header row (`.pane__header`). An editor group, a preview and every docked panel are drawn
   this way and in no other, and the header row is drawn **even when it holds nothing**: it is
   what puts every pane's content at the same y.
2. **The two lines are two tokens.** `--tyto-pane-strip-height` (30 px) and
   `--tyto-pane-header-height` (28 px) in `tokens.css`, border-box, the hairline under each line
   inside its height. The contract in `shell.css` is a fixed `height`, `flex: none`, one line
   (`white-space: nowrap`) and `overflow: hidden`, so nothing a pane puts in a line can make it
   taller; in the header row the breadcrumb slot (`.pane__breadcrumb`) gives way first, cut with
   an ellipsis, and the actions (`.pane__actions`) keep their size.
3. **A group's header row holds an empty breadcrumb slot and the group's actions.** The slot is
   `[data-breadcrumb]`, which TYTO-273 fills. "Open preview to the side" moves there from the end
   of the strip (changing ADR 0084 decision 7's "at the end of a group's strip"), so the strip
   holds tabs and nothing else, as ADR 0083 decision 3's pane was meant to.
4. **A preview's bar is its header row.** `.preview__bar` stays inside `<tyto-preview-pane>` —
   `paintPreview` finds its `data-preview-*` nodes inside the pane — and becomes a `.pane__header`:
   the formats take what is left, the slide, zoom and Lock keep their size. With a preview in
   front, the group hides its own header row, so a preview tab shows one row under its strip,
   never two (amends ADR 0084 decision 5).
5. **The BRIEF bar goes.** `EditorPanel` draws the groups and nothing over them (amends ADR
   0024's drawing and ADR 0083 decision 3). Its two contents go where a pane would put them:
   - the template picker — one `<select id="template">` with its label — is made once by
     `main.ts` and **moved into the focused group's header row**, so there is one picker, one
     listener and one id in the window, until TYTO-273's breadcrumb replaces it;
   - the word "Brief" is the status bar's tab kind (ADR 0076), which already said it; the
     catalogue's `editor.heading` is removed, and `editorChromeFor` stops answering a heading.
6. **A docked panel's strip is one tab.** The panel's name — the same heading element, so
   `#problems-heading` and its `data-i18n` stay — with the close button where a group's tab has
   its own, then the header row with the panel's controls. A plugin's panel uses the same base
   rather than its own bar; its manifest title is text Lit escapes, and its sandboxed page under
   the two lines is unchanged (ADR 0045). The tab is a `.pane__tab`, not a `.tabs__tab`: a
   group's tabs are counted and selected by the window, and a panel's name is neither. The name
   is in sentence case like a file's ("Problems", "Problemas"), no longer upper case.
7. **A quieter name.** The tab in front loses the strong weight and is told apart by colour
   alone: `--tyto-text` in front, `--tyto-text-muted` behind, a behind tab painting `--tyto-hover`
   under the pointer. The accent line on the tab in front is drawn only with a split, as before,
   now `--tyto-focus-width` thick. The title bar is unchanged (ADR 0078 decision 3).
8. **The renderer-tokens guard refuses a size in pixels.** `width`, `height` and their `min-`
   and `max-` forms join the radii, sizes, gaps, paddings, margins and borders it already refused
   outside `tokens.css` (amends ADR 0075's consequence that "layout measurements stay literal").
   The pane shape's heights are tokens, and a guard that let a `height` through could not keep
   them the only heights a line has. The fifteen declarations that wrote one moved to tokens; the
   group's minimum, `--tyto-group-min-width` and `--tyto-group-min-height`, is held equal to
   TYTO-289's `GROUP_MINIMUM` by the same guard.
9. **The two new icons are provisional.** `preview` and `lock` were drawn by TYTO-287 and are
   not on the sheet Rafael approved (TYTO-96, comment 1291169). They are redrawn here in the
   nine's manner — the frame, the 1.5 stroke on the 16 grid, the problems icon's dot — and put on
   a sheet beside them for his approval, which this ADR does not presume. _Amended the same day:_
   Rafael chose a thinner stroke from a sheet of the eleven at 1.5, 1.25 and 1.0, as a setting —
   `iconStrokeWidth` in `settings.json`, 0.75 to 2, default 1.25 — applied on save with the
   colours (`theme:current` carries it, ADR 0077's path) through `--tyto-icon-stroke`; the two
   dots are 0.4 of the stroke, their ratio at 1.5.

## What was measured

In the built window (`e2e/pane-shape.desktop.test.ts`), the busiest scene the window draws
today: a row split whose right group has a locked preview in front, whose left group has a dirty
tab and is split down again, the queue in the left dock, a plugin's panel in the right one and
Problems at the bottom. Every visible strip read 30 px and every header row 28 px; the four panes
whose strips start at the top of the docks end both lines at the same y (63 and 91), and the
two below them at theirs. Half a pixel of tolerance; making one pane's header a pixel taller
fails the helper, in the test. At 900x600 no line holds content taller than itself. Removing the
header token from `.pane__header` and rebuilding turned four of the suite's five tests red, the
header rows measuring between 0.8 and 25.25 px.

Contrast, measured by the guard on the built-in themes: text in front on the surface 14.67 light
and 10.57 dark; a muted name on the raised strip 5.96 and 5.68, on `hover` 5.33 and 5.05 (floor
4.5); the accent line on the raised strip 3.36 and 5.28 (floor 3, a graphical object).

## Consequences

- Every pane's content starts at the same y as its neighbours', and a new kind of pane has one
  base to draw from: `DockedPanel.chrome` for a panel, `<tyto-editor-group>` for a tab.
- The suites that read `#editor-heading` read the status bar's kind (`.status-bar__kind`); the
  ones that choose a template still find `#template`, in the focused group.
- Each pane spends 58 px on its two lines. In the bottom dock's default 140 px that leaves the
  Problems list room for about two rows; it was looked at in the screenshots, not measured.
- Not done here: the folder on hover (ADR 0086, the second pull request); dragging a tab to
  reorder it or onto another group (the third); the breadcrumb itself (TYTO-273); the font and
  size of each part (TYTO-272).
