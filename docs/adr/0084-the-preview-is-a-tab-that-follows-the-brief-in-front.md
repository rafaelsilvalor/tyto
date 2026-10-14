# 0084 — The preview is a tab that follows the brief in front

Status: accepted · 2026-10-14 · TYTO-287 · amends ADR 0024 (the preview leaves the dock) and
decision 6 of ADR 0083 (a click in a preview focuses its group)

## Context

Rafael asked on 2026-10-13 for the preview to be a kind of tab, the way VS Code and Zed show a
rendered `.md` beside its file: "Open Preview to the Side" opens "Preview CLAUDE.md" as a tab in
the group beside it. Read at `origin/main` on 2026-10-13: the preview was the PREVIEW panel,
`<tyto-preview-panel>` in the right dock of ADR 0024's record, with ids (`#preview-frame`,
`#format-tabs`, `#zoom-level`…), always showing the focused group's document. ADR 0083 had
already made a tab something other than a document (decision 2), naming the preview as the next
kind of tab.

The card said the preview tab was **bound to one brief**. Rafael changed that premise the same
day: the preview **follows the brief in front**, as VS Code's Markdown preview does, and a
**lock** pins it to one brief. His decision is what is built; the card's word is superseded.

The work lands in two pull requests. This record covers both; what the first leaves to the
second is said where it applies.

## Decision

1. **The preview is a tab kind, not a panel.** An `EditorTab` with `view: 'preview'` and an id
   of its own (`renderer/editor-groups.ts`). The PREVIEW panel is gone: its record, its element,
   its `layout.togglePanel:preview` command and its catalogue name. A `layout.json` that still
   names it reads like any record for a panel this build does not have — `layoutFrom` drops it —
   so nothing is migrated; a keybinding to the old toggle is `W_KEYBINDING_UNKNOWN_COMMAND`, as
   any unknown id is. The right dock is empty by default and its status-bar button is not drawn
   while no panel lives there (a plugin's panel docked right brings it back). "Restore layout"
   puts the docks back and leaves the groups alone, as ADR 0083 decision 7 says.
2. **A following preview shows the brief last in front.** The window keeps one brief id: the
   document of the last **brief's own tab** in front of the focused group. A settings,
   keybindings or snippets tab, or a preview, coming to the front leaves it alone, as VS Code's
   preview keeps the last Markdown file. When that brief closes, the preview follows the brief in
   front of the focused group, else the first brief in front of any group, else any open brief,
   else it shows the empty line. There is **at most one following preview** in a window.
3. **A locked preview keeps its brief.** "Lock" in the preview's bar, or the command, turns the
   preview in front (else the following one) into a locked one that keeps the brief it showed;
   unlocking makes it follow again. **At most one locked preview per brief**: locking a second
   one on the same brief closes the first, and letting a locked one follow while another follows
   closes the other. Closing a brief closes its locked previews; the following one stays and
   follows. A locked tab carries a lock after its name, "Locked to this brief" / "Prévia travada
   neste brief" on hover.
4. **A document is found by its own tab, never by its preview.** Opening a file another group
   shows, revealing a document, the set of documents the groups show and whether closing a tab
   leaves its document open elsewhere all look at text tabs only; a split of a preview opens its
   brief's text. Opening a file the preview shows goes to the file's text.
5. **The pane.** `<tyto-preview-pane>` (`renderer/preview-pane.ts`) is the panel's markup **with
   no ids** — every node is a `data-preview-*` attribute inside its own pane, because a following
   and a locked preview can be on screen at once — under a `.preview__bar` of formats, slide,
   zoom and Lock, which TYTO-288 restyles. Each `<tyto-editor-group>` keeps a pane beside its
   CodeMirror mount and shows one or the other by the kind of the tab in front. A preview in front
   makes the group's pane let go of its document, so its record passes to another pane (ADR 0083
   decision 5). `fit` follows a `ResizeObserver` on each stage, since a split resizes no window.
   A preview paints from the document's own state — frames, artworks, chosen format and slide,
   zoom, diagnostics — so two previews are two reads and no second request; a compile answer
   repaints when its document is on screen as text or as a preview.
6. **Focus and "active", changing ADR 0083 decision 6.** A click in a preview focuses its group:
   the pane is focusable and the frame takes no pointer events, so the click lands on it. With a
   preview focused, the active document is **the brief it shows**: export, the queue, the problems
   panel, the title and the status bar (kind "Preview", no line and column) answer about that
   brief. `commandOffered` knows the kind `preview`: the brief-only commands stay offered and act
   on that brief, and the commands that act on text — undo, redo, find, replace, go to line, the
   "/" menu — are not. The editor's own keys a focused preview answers from the window's
   dispatcher, since no CodeMirror view hears them: `Mod-s` saves the brief, `Mod-w` closes the
   preview, the tab keys move.
7. **Commands**, through ADR 0074's table, on the View menu and in the command bar:
   `preview.openToSide` on **`Mod-Shift-v`** (VS Code's key, global so it answers from a preview;
   free in CodeMirror's keymaps and in this table, and it takes Chromium's "paste as plain text"
   as VS Code's does), `preview.open` (in the focused group) and `preview.toggleLock`, with no
   default keys. All three are brief-only. "Open preview to the side" opens a new following
   preview in the group after the focused one — a new group split to the right when the focused
   one is the last — **and leaves the focus in the brief**, as VS Code does; when a following
   preview exists it comes forward and is focused. The button at the end of a group's strip, shown
   while a brief's own tab is in front, runs the same command.
8. **The first launch opens the preview, from the second pull request.** A new person should see
   art before they know the key, so a first launch opens the following preview to the side. It
   lands with decision 9, where "first launch" is measured against a session that keeps previews,
   and with a deliberate seam for the end-to-end suites, every one of which launches on a first
   run (the coordinator's decision of 2026-10-14, after the first pull request measured twelve
   unrelated suites going red with it). Until then a fresh window opens with no preview, and one
   comes from `Mod-Shift-v`, the strip's button, the View menu or the command bar.
9. **Keeping previews in `session.json`** is the second pull request (ADR 0080, amended then).
   Until it lands, a session keeps the groups **without** their previews: a group that held only a
   preview collapses, and a relaunch opens no preview.

## Consequences

- A brief and its art sit side by side as two tabs, a second brief's art can be pinned beside
  the first, and the preview can be closed, moved to another group or opened in the same one.
- The suites that read the panel's ids open a preview with the key and read the shown one through
  `e2e/preview-pane.ts`.
- `fit` measures the stage's own box rounded down rather than `clientHeight`, which Chromium
  rounds: a 574.7 px stage answered 575 and the 0.3 px overflow drew a 16 px scroll bar, seen
  once a split made `fit` go by height.
- What is not done: previews in the session and the first-launch preview (decisions 8 and 9, the
  second pull request); the strip's
  and the bar's final look (TYTO-288); dragging a preview tab between groups (TYTO-288).
