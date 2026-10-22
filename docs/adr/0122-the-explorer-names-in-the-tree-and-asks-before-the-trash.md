# 0122 — The explorer names in the tree, and asks before the trash

Status: accepted · 2026-10-22 · TYTO-352 · extends ADR 0121

## Context

ADR 0121 gave main the three writes and the native context menu, and left the window's half for
a second pull request: where a name is typed, what a re-list does to it, which keys act, how the
question before a delete knows about unsaved tabs, and what a write the disk refuses says. It
also left one open point: a create or a rename failing with something other than `EEXIST` or
`ENOENT` rejected the call, so the window could only stay silent.

## Decision

1. **The name is typed in the tree, and the field is tree state** (`editing` in
   `src/renderer/explorer-tree.ts`): `{ parentId, kind }` for a new entry, `{ renameId }` for a
   rename, each with the text typed and the line under it. It is kept apart from the listings, so
   a watcher's re-list redraws around it. It goes only when its folder comes back `gone` or the
   renamed entry is in no listing. The rows are drawn keyed by id, so the field's element stays.
2. **Enter or blur confirms, Escape cancels**, as in VS Code. An empty name or the name it had
   writes nothing. On success the window lists the folder at once and selects the id main gave;
   the later `explorer:changed` finds the same id. A refused name keeps the field and its text.
3. **A new entry goes in the selected folder, the selected file's folder, or the root**; from the
   panel's empty space, the root. What was typed is the name: no extension is added.
4. **F2 and Delete are the tree's own keys**, beside the arrows in `moveFor`, not keybindings: they
   act on the focused row only, and the field's keys never reach them.
5. **The question comes before the delete, always**, through `dialog:confirm`, in the approved
   words. Its count of unsaved tabs needs to know which tabs hold a file under the entry before
   anything moves, which only main can say, so **one new channel**, `explorer:tabs-under`. It
   takes an `entryId` and answers `documentIds`, ids of tabs and never a path. The window counts
   the unsaved ones itself.
6. **A rename's `moved` changes a tab's name and tooltip only**, keeping `savedText`, so a dirty
   tab stays dirty and its next save writes to the new path. A delete's `released` goes through
   `releaseDocument` (TYTO-104), so the text stays in a tab in no file.
7. **Any other refusal from the disk is the fourth reason, `failed`**, with the system's error
   code (`EPERM`, `EROFS`) as `detail`, never its message, which names a path. The field says
   "Couldn't save the change: {reason}." (approved by Rafael on 2026-10-22).
8. **The trash is called by the platform's name**: the Recycle Bin on Windows, the Trash on macOS
   and Linux in English; _Lixeira_ on all three in Portuguese.

## Consequences

- A person can make, rename and delete without leaving the window, and nothing they typed is
  lost to a change on disk.
- The delete question costs one extra round trip to main. It is a map lookup.
- A native menu cannot be driven by the end-to-end suite. It opens and closes the real one to
  measure the answer, and holds the 50 ms grace with a popup that calls `callback` before `click`.
