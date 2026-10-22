# 0121 — The explorer writes by id and name, and deletes only to the trash

Status: accepted · 2026-10-22 · TYTO-352 · under ADR 0010, ADR 0111 and ADR 0115 · applies
TYTO-104's rule for a tab whose file is gone

## Context

ADR 0115 built the explorer read-only: main lists the open folder by ids it mints, and the window
never holds a path a door would accept. Rule 8 left new, rename and delete for later, with one
promise: delete goes to the operating system's trash. TYTO-352 adds the three. Each one writes to
the disk, so the questions are different from listing: what a name may be, what happens when it
is taken, what a tab holding the file does, and where a deleted file goes.

Rafael answered the card's product question on 2026-10-22: "criar, renomear e apagar funcionam em
qualquer pasta, aprovada ou não." The three run nothing, so ADR 0111 does not restrict them.

## Decision

1. **Three channels, each taking ids and a name, never a path.** `explorer:create { documentId,
parentId | null, name, kind: file | folder }`, `explorer:rename { entryId, name }` and
   `explorer:delete { entryId }`. The schemas are strict, so a request carrying a path is refused,
   not stripped. Zod only bounds the name's length (1,000). Main decides what a name may be.
2. **One name rule, on every operating system** (`checkEntryName` in `src/main/explorer.ts`). Refused:
   an empty or blank name, `.` and `..`; `/`, `\`, NUL and every other control character, and
   `<>:"|?*`; a trailing dot or space; Windows' device names (`CON`, `PRN`, `AUX`, `NUL`,
   `COM1`–`COM9`, `LPT1`–`LPT9`, with any extension); more than 255 characters; and `.git`, in any
   case. Windows' rules apply on Linux and macOS too, so a folder made on one opens on the others.
   Nothing is trimmed: what was typed is the name, or it is refused with `invalid`. After the
   check, main also requires `dirname(resolve(parent, name))` to be the parent, and the parent's
   real path to be inside the open folder's.
3. **No write overwrites anything.** A new file is written with `wx` and a new folder with a
   `mkdir` that is not recursive, so the check and the write are one call. Rename asks first
   whether the target exists, because `rename` replaces a file, on Windows too. The one exception
   is a change of case on a disk that ignores case, where the target's real path is the entry's
   own. A name that is taken answers `exists`, and an entry or parent that has gone answers `gone`.
4. **Rename keeps ids.** The entry keeps its id, and every id under a renamed folder moves to the
   same relative path under the new name, so the window's expanded subtree survives. The kind
   follows the extension: `logo.png` renamed `logo.brief` is a brief.
5. **Tabs follow a rename.** `documents.retargetUnder(from, to)` moves every tab at or under
   `from`, with any label it carries (the queue's `<id> · brief.brief`). The answer lists each tab
   that moved, with its new name and `pathLabel`, so the window renames the tab. A tab with unsaved
   text keeps it; only where it saves changes.
6. **Delete goes to the trash and nowhere else.** Main calls an injected `trash(path)`, which the
   composition root makes `shell.trashItem`, looked up at each call so an end-to-end suite can
   replace it. **There is never a fallback to `rm`.** A trash that fails answers `trash-failed`, and
   the entry stays where it was. A delete that worked forgets the ids under the path, and
   `documents.releaseUnder(path)` answers the tabs that held a file there. Each of those tabs is now
   a tab in no file, as TYTO-104 makes a tab whose file another save took. Asking first is the
   window's job, through `dialog:confirm`, in the wording Rafael approved on the card.
7. **The context menu is native, and its labels are the window's.** `menu:context { x, y, items:
[{ id, label, enabled }] }` draws a `Menu.popup` at the point, scaled by the page's zoom as
   `menu:popup` is, and answers `{ chosen: id | null }`. Translating stays in the window, as it does
   for `dialog:confirm`. Main answers only an id it was offered enabled. The pick is read 50 ms
   after the menu closes, because an item's `click` can arrive after the close on Windows.
8. **They work in every folder, trusted or not.** Creating, renaming and deleting run nothing a
   folder ships, so ADR 0111 does not restrict them (Rafael, 2026-10-22).

## Consequences

- The window can create, rename and delete without ever naming a path. A hostile page can only
  name entries main listed, inside the open folder, and the worst it can do is move one to the
  trash, from which it can be restored.
- Two checks are a step apart. Between rename's existence check and the `rename` call, another
  program could create the target, and `rename` would replace it. That window is microseconds,
  and nothing on the platform closes it for folders.
- A delete in a folder the system cannot trash (some network drives) fails with `trash-failed`.
  It never falls back to a hard delete, so the person deletes it outside the app.
- These channels are main's half of the card. The menu, inline naming in the tree, the keys, the
  tabs' wiring, the strings and the end-to-end suite are its second pull request.
