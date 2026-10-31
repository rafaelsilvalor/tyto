# 0090 — A document is a tab, a tool has a header

Status: accepted · 2026-10-16 · TYTO-302 · amends decision 6 of ADR 0085

## Context

ADR 0085 (TYTO-288) drew every pane as a tab strip, and its decision 6 gave each docked panel —
Problems, the local queue, a plugin's panel — a one-tab strip: the panel's name in a tab with a
× where a group's tab has its own. That was the alignment's choice, and it made a tool look like
a file you close.

Rafael noticed on 2026-10-15 that the queue is not an editor and has nothing to do with one.
Read in the code: `queue-panel.ts` never reads the active document; it lists and runs the tasks
of a folder. Problems reads the document in front's diagnostics but edits nothing, and a plugin's
panel is a sandboxed page (ADR 0045). VS Code keeps the two apart: documents are tabs in the
editor area, and a tool in the side bar sits under a fixed view title ("EXPLORER") with its own
actions at the right. Rafael approved giving Tyto's tools that look the same day.

## Decision

1. **A document is a tab; a tool has a header.** An editor group's strip keeps its tabs (ADR
   0083, ADR 0085). A docked panel's strip is a tool header, drawn by `DockedPanel.chrome()` in
   `src/renderer/panels.ts` for all three panels: no tab shape, no fill of a tab in front, the
   panel's own background (`--tyto-surface`) under it.
2. **The strip stays the strip.** The header is still a `.pane__strip`, of
   `--tyto-pane-strip-height`, so ADR 0085 decision 1 holds unchanged — the strips' bottoms meet
   across the window, and `e2e/pane-shape.desktop.test.ts` measures it. `.pane__strip--tool` is
   the modifier that changes the look, and the same suite asserts every docked panel has it and
   no group does.
3. **The title is small capitals, as a view title is.** `.tool__title` holds the tool's name in
   upper case (`text-transform`, so the catalogue keeps sentence case and the DOM text is still
   "Problems"), in `--tyto-text-xs` and `--tyto-text-muted`. `#problems-heading` and its
   `data-i18n` stay on the same element; a plugin's manifest title is still text Lit escapes.
   `.tool__title` is the hook a dock switcher takes over when a dock holds more than one tool
   (TYTO-279's Explorer beside the queue): the title becomes the switcher — VS Code's view
   switcher or an activity bar, to be chosen then — and the actions stay where they are.
4. **The tool's actions sit at the right end, the close button last.** The close button is
   still a × in text, still the dock's and not the panel's, and still runs `onClose` — the same
   path as `layout.togglePanel:<id>` from the View menu and the status bar. Only the queue has an
   action: "Choose folder…" moves out of its body into the header as a folder icon (`folder` in
   `icons.ts`, on the nine's frame and the `iconStrokeWidth` stroke), its words on `title` and
   `aria-label`, offered once the queue has answered, as the body button was. The body keeps its
   other controls (forget the folder, auto-run, the kinds, and each task's run, open brief, open
   output). There is no "run all" or "refresh": the list follows `queue:changed`. Problems and a
   plugin's panel have no actions.

## Consequences

- The panels' `.pane__tab`, `.pane__name` and `.pane__title` go; a test or a plugin that
  selected them selects `.tool__title`. `.panel__close` stays, so what closes a panel is found
  the same way.
- The queue with no folder chosen says where the button is ("Choose one with the folder button
  above"), since its body no longer holds one.
- The folder icon is drawn provisionally, like `preview` and `lock`, and waits on Rafael's look
  at an icon sheet.
- Two tools in one dock are not built here; decision 3 only says which element a switcher
  replaces.

**Superseded in part on 2026-10-30 by ADR 0163 (TYTO-496):** in the bottom area the switcher decision
3 foresaw is built. The area's tabs take the place of the title of the panel in front.
