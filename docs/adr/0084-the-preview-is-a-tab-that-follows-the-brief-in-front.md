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
   CodeMirror mount and shows one or the other by the kind of the tab in front. _Changed by ADR
   0085 (TYTO-288): the bar is the group's discreet header row, of the token height, and with a
   preview in front the group hides its own; "Open preview to the side" (decision 7) sits at the
   right end of the strip._ A preview in front
   makes the group's pane let go of its document, so its record passes to another pane (ADR 0083
   decision 5). `fit` follows a `ResizeObserver` on each stage, since a split resizes no window.
   A preview paints from the document's own state — frames, artworks, chosen format and slide,
   zoom, diagnostics — so two previews are two reads and no second request; a compile answer
   repaints when its document is on screen as text or as a preview.
   _Changed by ADR 0123 (TYTO-323): the slide picker is gone; a slide is chosen from a strip of
   thumbnails under the stage, and the bar holds formats, the strip's toggle, zoom and Lock._
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
8. **The first launch opens the preview to the side.** A new person should see art before they
   know the key. "First launch" is measured against the session: no `session.json`, or one with
   no `groups` — a file a build before TYTO-286 wrote, so the first launch after that upgrade
   counts too. A file that is there but cannot be read — cut short, edited by hand, a newer
   version's, a folder in its place — or whose tree does not parse is not a first launch:
   somebody used the app in that folder (`UNREADABLE_SESSION`). Every session this build writes carries
   `groups`, one empty group when the window has nothing to keep (`NO_GROUPS`), because a window
   holding only its untouched tab, preview closed, would otherwise write none and get the
   preview back on every launch. Afterwards the session decides. The preview opens as
   `Mod-Shift-v` opens it: following, in a new group to the right, the focus left in the brief.
   **The end-to-end suites are second launches by a seam in the harness, not in the app**
   (the coordinator's decision of 2026-10-14, after the first pull request measured twelve
   unrelated suites going red with the preview opening in each): `e2e/not-a-first-launch.setup.ts`,
   a `setupFiles` entry, wraps Playwright's `_electron.launch` and writes the empty session into a
   launch's `--user-data-dir` unless the folder already has a `session.json` or the launch's
   `env` says `TYTO_E2E_FIRST_LAUNCH=1`. Nothing in the app reads a variable or a switch to skip
   the first launch, so a packaged app cannot be told to; the cost is that a suite which needs a
   real first launch says so (`preview-session.desktop.test.ts`).
9. **The previews are kept in `session.json`** (ADR 0080, amended). A following preview is
   `{ view: 'preview' }` and names nothing: it shows the brief in front when the window opens.
   A locked one is `{ tab, view: 'preview', locked: true }`, the index of its brief's session tab.
   Neither keeps a `place`, and no path is ever written for one. Main turns the window's ids into
   indices as for any tab, so a locked preview whose brief was not kept is dropped, and on the
   way back one whose brief did not return is dropped too; a group left empty collapses. A
   rebuilt tree holds at most one following preview and one locked preview per brief, whatever
   the file says. A session whose only kept tab was a following preview beside the untouched tab
   rebuilds no tree, so the window opens that preview to the side again. A restored brief is
   compiled once it is built, as before, so a restored preview paints its art from that answer.
   _Extended by ADR 0123 (TYTO-323): either shape may carry `stripHidden: true`, a preview that
   hid its strip of slides; a record without it shows the strip._
10. **Replacing the untouched tab carries its locked preview.** When a file opened replaces the
    tab nobody typed in, every tab of that tab's document — a preview locked on it included — now
    shows the file, rather than a preview locked on a document that no longer exists, which no
    close would ever reach. Measured in `editor-groups.test.ts` for the first pull request's open
    question; the lock is kept because the tab it was locked beside became that file.

## Consequences

- A brief and its art sit side by side as two tabs, a second brief's art can be pinned beside
  the first, and the preview can be closed, moved to another group or opened in the same one.
- The suites that read the panel's ids open a preview with the key and read the shown one through
  `e2e/preview-pane.ts`.
- `fit` measures the stage's own box rounded down rather than `clientHeight`, which Chromium
  rounds: a 574.7 px stage answered 575 and the 0.3 px overflow drew a 16 px scroll bar, seen
  once a split made `fit` go by height.
- The strip's and the bar's final look landed with TYTO-288 (ADR 0085), and a preview tab is
  dragged between groups like any other since its third pull request (ADR 0083, amended
  2026-10-16): it keeps its id and its lock, and a following one keeps following.
- _Amended 2026-10-23, TYTO-366 (ADR 0124):_ a following preview shows the last thing chosen, a
  brief brought to the front or an image clicked in the explorer, not only the brief in front.
