# 0083 — The editor splits into groups, each with its own tabs

Status: accepted · 2026-10-13 · TYTO-286 · amends ADR 0024 (the tab strip stops being the
window's) · supersedes D2 of `docs/explorations/2026-09-16-document-buffer-model.md`

## Context

Rafael asked for the editor to split right and down, with each side's tabs on top of the side
they belong to, as Zed and VS Code do (TYTO-286). Read at `origin/main` on 2026-10-13: the window
is four docks laid out from `layout.json` (ADR 0024, `renderer/dock.ts`), there is **one** tab
strip for the whole window (`renderer/tabs.ts`, `<tyto-tabs>` in `index.html`), above the editor
and the PREVIEW panel alike although the tabs are only the editor's, and one CodeMirror view
shows one document at a time. Nothing could show two documents at once.

The exploration of 2026-09-16 (D2, never an ADR) had planned for a second view of a document as a
**read-only mirror**. A mirror that cannot be typed into is not what the editors this card names
offer, and the buffer model since TYTO-115 (D1: the workspace owns each document's
`EditorState`) makes an editable second view possible without a second owner.

The work lands in two pull requests. This record covers both; what the first leaves to the second
is said where it applies.

## Decision

1. **The editor panel is a tree of editor groups**, beside ADR 0024's docks and not inside their
   record. A leaf is a group — a row of tabs and the one in front; a node is a split, `row` (to
   the right) or `column` (down), with each child's share of the space. The tree is pure data in
   `renderer/editor-groups.ts`, next to `documents.ts`: the workspace says which documents are
   open, the groups say where each is shown. A split in the direction its parent already runs
   adds a sibling; any other nests. Closing a group's last tab closes the group and the split it
   leaves with one child collapses into that child. The last group stays, and the window puts a
   new untitled document in it, as closing the last tab always has. There is no limit on groups,
   only a minimum size in `shell.css`.
2. **A tab is not a document.** A tab has an id of its own and names the document it shows, so one
   document can be a tab in two groups, and a tab that shows something other than a document —
   the preview, TYTO-287 — is a new kind of tab rather than a fake document.
3. **The tab strip stops being the window's.** Each group is a `<tyto-editor-group>`: its own
   `<tyto-tabs>` on top and the node a CodeMirror pane is mounted in under it. It is shaped as a
   **pane** — a strip, then the content — so TYTO-288 can extend the same shape to the docks. The
   first group's mount carries `id="editor"`, so a window with one group is the window every
   earlier suite and stylesheet knows. A rearrange **moves** group elements and never rebuilds
   them, so no pane is unmounted under a person's text.
4. **One editor, several panes.** `@tyto/editor`'s `createEditor` makes the first pane and
   `createPane` the others: one set of extensions — the input and theme compartments, the command
   registry and the listener that reports a transaction — and one view per group. A
   `createEditor` per group would have been a second set of compartments, and a state shown in
   another handle's view would report to the wrong listeners and be reconfigured through a
   compartment it does not carry, writing text into the wrong document with no error. The
   listener now says which view a transaction happened in, and the window files it under **the
   document that view shows** — never the focused one, since a lint answer or a copied change is
   a transaction in a pane nobody is looking at.
5. **One document in two groups: one record, one history, both panes editable.** The workspace
   keeps the document of record, with its undo history, and shows it in one pane, its
   **primary**. Every other pane showing the document holds a **follower**: the same text and its
   own selection, no history (the history sits in a compartment the follower reconfigures away).
   A change in either is copied into the others under an annotation, which is how a copy is told
   apart from typing and never copied back. An undo or redo asked of a follower runs in its
   primary — `Mod-z` and vim's `u` both reach the registry's undo, which resolves the view — so
   there is one history whichever pane the person is in. The primary role passes when the primary
   stops showing the document: another pane takes the record with its own selection, and the
   other followers follow it. This supersedes D2's read-only mirror.
6. **Focus and "active".** One group is focused; it changes on a click or focus inside a group, on
   a split (the new group takes it) and on closing a group (its neighbour takes it), and not on a
   click in the problems panel or the preview. **The active document is the focused group's tab in
   front**, and everything that read "the document in the editor" follows it: the status bar, the
   problems panel, the PREVIEW panel, the title, the command bar and the brief-only gating of
   TYTO-283, the template picker, the "/" menu, a skeleton, the plugins' panels and the template
   mode's way back. `Mod-1`…`Mod-9`, `Mod-PageUp`/`Mod-PageDown` and `Mod-w` act within the
   focused group. Opening a file another group already shows goes to that tab. A brief's preview
   answer reaches the gutter of every pane that shows it, keyed per document.

   > **Changed by ADR 0084 (TYTO-287).** The preview is a tab now, and a click in a preview
   > focuses its group; with a preview focused, the active document is the brief it shows.

7. **Commands.** Through the ADR 0074 table, as built-in defaults (Rafael's decision): `Mod-\`
   splits right, `Mod-Shift-\` splits down, `Mod-Alt-ArrowLeft` and `Mod-Alt-ArrowRight` move
   focus to the group before and after. `Mod-\` is free in CodeMirror's keymap; `Mod-Shift-\` is
   CodeMirror's "go to the matching bracket", which the desktop set now shadows outside vim. Vim
   splits with `:vsplit` and `:split`. Both splits are on the View menu (ADR 0078) and in the
   command bar. A split opens the same document. "Restore layout" puts the docks back and leaves
   the groups as they are.
8. **The groups are kept in `session.json`** (ADR 0080, amended in place by the second pull
   request): an optional `groups` field in its version 1, the tree with each tab naming a session
   tab by index and carrying its own cursor and scroll, and the focused group. A window with
   several groups comes back after a restart with the same tree, the same tabs in each group,
   the same one focused and each pane's cursor where that pane left it. A split, a move and a
   group close are refused until the last session has been read, as a write is.
9. **Three more commands**, through the same table and on the View menu, with no default keys:
   focus the next or the previous group (tree order, wrapping at the ends — `Mod-Alt-ArrowLeft`
   and `Mod-Alt-ArrowRight` wrap with them), move the tab in front to the next group (with one
   group, a split to the right is made for it, as VS Code does), and close the focused group,
   each tab as `Mod-w` closes it, so an unsaved one asks first and a _keep_ stops the close.

## Consequences

- Two briefs can be read and written side by side, and one brief can be edited in two places
  with one undo history.
- `docs/architecture.md`'s description of one CodeMirror serving every tab now reads one editor,
  one pane per group.
- The PREVIEW panel still sits in the right dock and follows the focused group; becoming a tab is
  TYTO-287. Dragging a tab onto a group or a group's edge is TYTO-288.
- Moving a tab to another group, focusing the next group by order, closing a group and keeping
  the groups across a restart landed in the second pull request (decisions 8 and 9). The shares
  of a split are kept, though nothing changes them yet: there is no splitter between groups.
- _Amended 2026-10-14, TYTO-289:_ a splitter between sibling groups changes them. A drag or an
  arrow key moves only the line's two neighbours, never below `GROUP_MINIMUM` (160 px across,
  96 px down, the same as `shell.css`'s); a double-click gives every child of that split an equal
  share, not only the pair; the shares are written when the drag ends, like a dock's size.
