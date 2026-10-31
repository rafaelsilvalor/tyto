# 0165 — Each workspace folder keeps its own tabs

Status: accepted · 2026-10-31 · TYTO-513 · beside ADR 0080 and ADR 0113, under ADR 0010 and ADR
0086

## Context

ADR 0080 keeps the window's tabs, drafts included, in one `session.json`, and ADR 0113 added the
one workspace folder the window has open. Since TYTO-487 the title bar lists the recent folders,
so switching folders is one click. A switch kept the tabs of the folder being left: briefs of
Monday's task stayed open over Tuesday's folder, and nothing brought Monday's back on return.

Rafael asked for Zed's behaviour on 2026-10-31: each folder remembers the tabs open in it, and
opening the folder again brings them back. ADR 0080 and ADR 0113 are closed; this ADR adds to the
record they define the way their own optional fields were added.

## Decision

1. **The record keeps the other folders' tabs beside the window's.** `session.json` takes an
   optional `folders` list, newest first. Each entry is `{ folder, tabs, active, groups }`: the
   folder's real path as main opened it, or `null` for the window with no folder open, and the
   three fields the top level already keeps, in the same shapes. The top level stays the window as
   it was left. **The version stays 1**, so a file written before this ADR is a session that
   remembers no other folder, and reading it is the whole migration. An entry that does not parse
   is dropped alone: it costs that folder's tabs and no one else's.
2. **The template mode stays the window's.** Its folder is not a workspace folder (TYTO-266), and
   it is kept at the top level across a switch.
3. **At most ten other folders**, `RECENT_LIMIT`, the recent list's own cap: every folder the
   list can offer can have its tabs, and the file does not grow without end. The oldest entry
   goes first.
4. **The window writes, main files.** Before either door asks for a folder (the picker and the
   recent list, and Close Folder), the window writes its session as a reload does. When main's
   answer opens another folder — compared as the recent list compares them, case folded on
   Windows only — main moves the tabs last written under the folder left, and lifts the new
   folder's entry, or nothing, to the top level, with the new folder in `workspace`. No channel
   changes and none takes a path (ADR 0010, ADR 0086): main already knows both folders.
5. **The window reloads to show them.** The page that reads next restores the new folder's tabs
   with ADR 0080's rules unchanged: a draft goes over its file only if the file still has the
   hash the draft was written against, a draft against a changed file comes back `stale` beside
   it, and a file that is gone loses its tab and says so. Until that page reads, main drops the
   leaving page's writes, which hold the old folder's tabs and would otherwise land on the new
   one's. **A folder with no tabs kept keeps the window's arrangement**: its groups are the
   window's less every tab that names a document, so a following preview that was open stays
   open and a window that had none gets none. They are never absent, which would read as a
   first launch (ADR 0084 decision 8) and open a preview the person had closed. Once the page has restored, it marks `<html data-session="restored">`; the e2e
   suites that switch folders wait for it on the new page.
6. **Unsaved text comes back, as in Zed; nothing asks.** The write in decision 4 keeps every
   draft with its hash, so leaving a folder loses nothing. Only when that write fails while a tab
   holds unsaved text does the switch not happen, and the status bar says so — the rule a reload
   already follows (ADR 0080). Asking on every switch would put a dialog in the common case for
   no safety a successful write does not already give. **Rafael chose this on 2026-10-31**, over
   asking before leaving a folder with unsaved changes: "Volta sozinho" (it comes back by itself).

## Consequences

- A person leaves three briefs open in one folder, opens another from the recent list, and finds
  the three briefs, drafts included, when they come back.
- A switch reloads the window, so the screen flashes once. Swapping the tabs in place, without a
  reload, is a candidate follow-up; it needs a second restore path in the window.
- **The window with no folder open is a folder of its own.** Briefs opened before File ▸ Open
  Folder stay with "no folder": they are not in the folder's tabs, and they come back when the
  folder closes. Close Folder therefore empties the window of the folder's tabs rather than
  keeping them open outside it.
- The relabelling of open tabs on a folder change (TYTO-274, ADR 0125) now runs only when the
  same folder is read again: another folder reloads the window, whose tabs are labelled afresh.
- Panel sizes, the bottom area's tab and the terminal's processes stay the window's, not the
  folder's.
- A switch whose record could not be written reloads onto the last record on disk, which reopens
  the folder that was left with its tabs: nothing is lost, and the folder did not change.
