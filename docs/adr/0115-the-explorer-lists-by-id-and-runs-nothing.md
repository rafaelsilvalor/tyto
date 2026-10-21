# 0115 — The explorer lists the open folder by id, watches it, and runs nothing

Status: accepted · 2026-10-21 · TYTO-279 · under ADR 0010, ADR 0086, ADR 0111 and ADR 0113

## Context

Rafael asked on 2026-10-12 for an explorer like VS Code's: the files of the open folder in a
panel, a brief opened by a click. When the card was written the window had no open folder;
TYTO-278 gave it one (ADR 0113), and the folder main has open is the one this lists.

The window has been held to one rule since E9.8: **it gets names and opaque ids, never a path it
can use** (ADR 0010). ADR 0086 lets a path cross to be shown, and no door that reads takes one
back. A file tree is the first screen where the window needs to name every file of a folder,
so whatever it names them by is the question this ADR answers.

## Decision

1. **Main lists, one folder at a time, by id.** `explorer:list { entryId | null }` answers the
   children of the folder that id names (`null` is the open folder itself) as
   `{ id, name, kind }`, `kind` one of `folder`, `brief`, `file`. Each id is a random string main
   mints the first time it lists a path and keeps beside it. The same path gets the same id for
   as long as the folder is open, so a re-list keeps the tree's expanded branches. The ids are
   dropped when the folder closes or another one opens. The request schemas are strict, so a
   request carrying a path is refused, not stripped. A folder nobody expanded is never read.
2. **Every listed entry is resolved and must still be inside.** `realpath` on each child, then
   `isInside` the folder's real path. A symbolic link or a Windows junction leading out of the
   folder is not listed. One leading to somewhere inside is an ordinary entry. This is the
   confinement ADR 0111 gives a restricted folder, applied to every folder, since listing is
   reading. A click asks again (`realpath`, inside, a file), because a file can become a link
   between a listing and a click.
3. **An id that names nothing answers an empty listing marked `gone`**, never a throw: an id
   main did not mint, one minted for a folder that has since closed, a file's id, or a folder
   deleted or renamed outside the app. The window drops that branch the next time it re-lists.
4. **Order and limits.** Folders first, then names compared as a person reads numbers
   (`slide 2` before `slide 10`), case-insensitively. At most **2,000 entries per folder
   listing**, with `more` counting the rest, which the panel shows as one row. The cap is per
   folder and not on the tree, because listing is lazy. `.git` is not listed. `node_modules` is
   listed, as VS Code lists it.
5. **One recursive watcher per open folder** (`fs.watch(folder, { recursive: true })`: native on
   Windows and macOS, Node's own walk on Linux). A burst of events settles for **150 ms**, then
   main pushes `explorer:changed`, which is empty, as `queue:changed` is. The panel lists each
   folder it has expanded again. Events under `.git` or `node_modules`, at any depth, are
   dropped: an install or a checkout would otherwise re-list everything for changes nobody is
   looking at, and an expanded `node_modules` therefore shows its last listing. The watcher is
   closed when the folder closes, when another opens, and at quit. A generation counter
   discards any event or timer that outlives its watcher, since closing a platform watcher does
   not promise that an event already queued is not delivered. A folder that cannot be watched
   still lists. It is just not live.
6. **A click opens a brief, and nothing else does anything.** `explorer:open
{ documentId, entryId }` opens a `.brief` main listed, through the same `openPath` the
   queue's brief uses. Any other file, a picture included, does nothing. There is deliberately
   no `shell.openPath`: handing a file from an untrusted folder to the operating system would
   run an `.exe` or a `.bat` that the folder shipped, and ADR 0111 says nothing a source ships
   runs before the person trusts it. An untrusted folder lists exactly as a trusted one, since
   listing runs nothing.
7. **The home folder lists nothing.** A folder whose `.tyto` is `TYTO_HOME` is never opened as
   a workspace (ADR 0112), so `workspace:folder` answers no folder and the explorer has no root.
   Nothing is lost by it: only briefs open, and a brief there still opens through File ▸ Open.
8. **New, rename and delete are not in this card.** When they come, delete goes to the
   operating system's trash and is never a hard delete.

## Consequences

- The window can draw the folder's whole tree without ever holding a path that a door would
  accept. An id outlives nothing: closing the folder makes every id the window holds mean
  nothing.
- The workspace service tells the explorer the folder after every open, re-read and close
  (`onFolder`). Re-reading the same folder after a trust change keeps the ids and the watcher,
  so the tree does not collapse.
- Opening a picture or a PDF from the explorer is a later card if Rafael wants it. It would need
  its own answer to ADR 0111 (an image viewer inside the window, say), not the system's
  default program.
- The panel, its status-bar button, its Ctrl+K toggle and the end-to-end suite are this card's
  second pull request.

## Amendment: the panel (TYTO-279, second pull request, 2026-10-21)

Rafael answered the card's taste questions on 2026-10-21. These are the decisions the panel
adds:

1. **In the left area, above the queue, headed EXPLORER / EXPLORADOR.** The record comes before
   the queue's in `DEFAULT_LAYOUT`, and a dock stacks its panels in that order. `layoutFrom`
   keeps that order for a `layout.json` written before the panel existed, so the explorer lands
   above the queue there too. One consequence: showing an empty left area (ADR 0076) now opens
   the explorer, which is its first panel, where it used to open the queue.
2. **An explicit File ▸ Open Folder opens it; nothing else does.** Only when the picker answers
   with a folder other than the one open. A folder the session brings back at launch leaves the
   panel as the saved layout has it, so a person who closed the explorer finds it closed. A
   dismissed picker changes nothing. Close Folder leaves the panel open, saying "No folder
   open" with an Open Folder… button.
3. **A status-bar item `explorer`**, beside the queue's (ADR 0091), and
   `layout.togglePanel:explorer` in the command bar, as every panel has. The button's icon is
   the tree Rafael chose from three candidates and approved, lifted onto the 2.75–13.25 band of
   the frame icons. The rows' chevron is drawn once and turned. Both are in `icons.ts`. There
   are no file-type icons: TYTO-282 owns those.
4. **The tree is a value in the window** (`explorer-tree.ts`): each opened folder's listing by
   id, which folders are open, and the selection. A change on disk lists the root and each open
   folder on screen again. A folder answered `gone` drops its subtree, so a folder deleted
   outside the app goes away with whatever was open inside it, and a selection inside it moves
   to the folder. The keys are VS Code's: Up, Down, Home, End, Right, Left, Enter and Space.
5. **The panel forgets which folders were open when it closes.** The dock makes a new element
   each time it opens a panel, as it does for the queue, and the record is layout rather than
   state. A panel kept open keeps its tree across changes on disk and across a trust change
   (the same folder, the same ids).
