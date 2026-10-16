# 0085 — Every pane is a tab strip and a header row

Status: accepted · 2026-10-14 · TYTO-288 (first of three pull requests) · amends ADR 0024 (the
BRIEF header), decision 3 of ADR 0083 and decision 5 of ADR 0084 · decision 6 amended by ADR 0090

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

The shape was revised the same day, before merge, after Rafael looked at the window and sent VS
Code as the reference (2026-10-14): a breadcrumb row under the tabs that is barely there, the
editor's actions at the right end of the tab strip, and panels with a tab strip and nothing
under it. What follows is the revised shape.

1. **Every pane has a tab strip, and the strips meet.** An editor group, a preview and every
   docked panel draw a `.pane__strip` of one height, `--tyto-pane-strip-height` (30 px), in the
   raised fill and with no line under it — the hairline it first carried went after Rafael
   marked it on the queue's strip and a group's (2026-10-14); the height was border-box, so it
   stays 30 px. Panes whose strips start at the same y end them at the same y.
   The contract in `shell.css` is a fixed `height`, `flex: none`, one line (`white-space:
nowrap`) and `overflow: hidden`, so nothing in a line can make it taller.
2. **An editor group adds a discreet header row, and those meet among themselves.** Under each
   group's strip, a `.pane__header` of `--tyto-pane-header-height` — 22 px, VS Code's breadcrumb
   height — in the editor's own background, with no hairline above or below and no box, and small
   muted text (`--tyto-text-xs`, `--tyto-text-muted`). It holds the breadcrumb slot
   `[data-breadcrumb]` and nothing else; it is empty until TYTO-273 fills it, and when it has
   content the slot gives way first, cut with an ellipsis.
3. **The group's actions are at the right end of its strip,** as VS Code's editor actions are:
   "Open preview to the side" is an icon button there, the size of a tab's close button, with a
   tooltip and an `aria-label` (changing ADR 0084 decision 7's "at the end of a group's strip"
   only in that the strip now ends in a `.pane__actions` box any other per-group action joins).
4. **A preview's bar is its group's header row.** `.preview__bar` stays inside
   `<tyto-preview-pane>` — `paintPreview` finds its `data-preview-*` nodes inside the pane — and is
   a `.pane__header` with the same discreet style: the formats take what is left, the slide, zoom
   and Lock keep their size, its controls small enough to fit the row. With a preview in front
   the group hides its own header row, so a preview tab shows one row under its strip, never two
   (amends ADR 0084 decision 5).
5. **The BRIEF bar goes, and the template picker leaves the window.** `EditorPanel` draws the
   groups and nothing over them (amends ADR 0024's drawing and ADR 0083 decision 3). The word
   "Brief" is the status bar's tab kind (ADR 0076), which already said it; `editor.heading` leaves
   the catalogue. The template `<select>` is gone (Rafael crossed it out on the screenshot; it was
   going to leave with TYTO-273 anyway), with `template.none`: a template is chosen with "New
   brief from template…", the "/" menu, completion and the `template:` line. What decided whether
   choosing one may edit a tab's text is still decided — the "/" menu's rows ask it — under the
   name `templateEdits`.
6. **A docked panel has a one-tab strip and no header row.** Problems, the queue and a plugin's
   panel have no actions to put in one, and VS Code's panels have none. The tab is the panel's
   name — the same heading element, so `#problems-heading` and its `data-i18n` stay — with the
   close button where a group's tab has its own. A plugin's panel uses the same base rather than
   its own bar; its manifest title is text Lit escapes, and its sandboxed page under the strip is
   unchanged (ADR 0045). The tab is a `.pane__tab`, not a `.tabs__tab`: a group's tabs are
   counted and selected by the window, and a panel's name is neither. The name is in sentence case
   like a file's ("Problems", "Problemas"), no longer upper case.

   > **Amended by ADR 0090 (TYTO-302).** A docked panel is a tool, not a document, and its strip
   > is a tool header rather than a tab: the same `.pane__strip` and height, with
   > `.pane__strip--tool`, the name in small capitals in `.tool__title`, and the tool's actions
   > before the close button. The queue's "Choose folder…" is a folder icon there.

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
Problems at the bottom. Every visible strip read 30 px; the four panes whose strips start at the
top of the docks end them at y 63, and every group's header row reads 22 px right under its strip
(the top two end at 85). No docked panel has a header row. Half a pixel of tolerance; making one
panel's strip a pixel taller fails the helper, in the test. At 900x600 nothing inside a line
reaches above or below it, measured by boxes. The header row is the editor's background with two
zero-width borders, read from the computed style. Removing the strip token from `.pane__strip` and
rebuilding turned the suite red ("expected 20.8 to be close to 30").

After the hairline under the strips went (Rafael, 2026-10-14), the same scene read every strip
30 px still and all six visible strips a computed `border-bottom-width` of `0px`; putting the
border back and rebuilding turned that assertion red with all six named at 0.8 px, while the
heights stayed 30 px — the border had been inside the height.

The first version of this pull request had a 28 px header row on every pane, with a hairline and
the template picker in it; it measured 30 and 28 px everywhere and was replaced, not amended.

Contrast, measured by the guard on the built-in themes: text in front on the surface 14.67 light
and 10.57 dark; a muted name on the raised strip 5.96 and 5.68, on `hover` 5.33 and 5.05 (floor
4.5); the accent line on the raised strip 3.36 and 5.28 (floor 3, a graphical object).

## Consequences

- Every pane's strip meets its neighbours', every group's content starts at the same y as the
  other groups', and a new kind of pane has one base to draw from: `DockedPanel.chrome` for a
  panel, `<tyto-editor-group>` for a tab.
- The suites that read `#editor-heading` read the status bar's kind (`.status-bar__kind`). The
  five that used `#template` choose or list templates through the "/" menu or "New brief from
  template…" now, asserting what they asserted before.
- Not done here: the folder on hover (ADR 0086, the second pull request); dragging a tab to
  reorder it or onto another group (the third); the breadcrumb itself (TYTO-273); the font and
  size of each part (TYTO-272).
