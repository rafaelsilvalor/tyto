# 0086 — A folder reaches the window only to be shown

Status: accepted · 2026-10-16 · TYTO-288 (absorbing TYTO-274) · beside ADR 0010

## Context

Rafael asked on 2026-10-12 for a tab to show, on hover, the folder its file is saved in
(TYTO-274, absorbed by TYTO-288 as its second pull request; ADR 0085 reserved this number). The
card read `shared/ipc.ts` as saying the window is never given the folder, by design, and asked
for a way to send a folder for display only.

**That premise was stale when this was built.** Read at origin/main on 2026-10-16: every channel
that brings a file into a tab — `file:open`, `file:reopen`, `file:save`, `queue:open-brief`,
`settings:open`, `keybindings:open`, `snippets:open` and `session:read` — answers with the same
`openDocument` shape, `{ path, name, text }`, and `path` is the whole absolute path. It has
crossed since E9.8 as the key a recent entry is reopened by. So the window already could know
the folder; what keeps it from reaching a disk is not that it lacks a path but that main refuses
any path it did not offer — `recent.knows(path)` in `src/main/documents.ts`, before anything is
read (ADR 0010). Before this ADR the tab's `title` was the file's name again.

## Decision

1. **Main writes the folder as a sentence, and the window shows it.** `openDocument` gains
   `folderLabel`: the folder the file is in, with the home directory written `~`
   (`folderLabelOf` in `src/main/folder-label.ts`; Windows compares without case and keeps the
   folder's own spelling; a root is never a home). Every door above carries it, because they all
   answer through `adopt` or `save` in the document service. No new channel.
2. **For display only.** The window keeps it on the document (`DocumentState.folderLabel`) and
   puts it in one place, the tab's `title`. It never sends it back, and no channel that opens or
   writes a file accepts it: `file:reopen` still takes a path and still asks `knows()` first,
   unchanged. Handed back as a path, the label opens nothing, which the unit and the end-to-end
   suites both ask.
3. **The tooltip is the folder, and nothing else**, as Zed and VS Code show it: the name is
   already on the tab. A tab in no file — untitled, or released by a save-as elsewhere (TYTO-104)
   — has no `title` at all. A preview tab shows the folder of the brief it shows. The app's own
   files show theirs, the data folder.
4. **Worked out at every open, never stored.** `session.json` keeps paths and kinds as before;
   a restored tab gets its label from main when the session is read back, so a label follows the
   machine's home directory rather than the one it was written under. A save-as moves it with the
   file.
5. **The quieter name is ADR 0085's**: the tab in front is normal weight in the text colour,
   settled in the first pull request; nothing here restyles a name.

## Consequences

- The breadcrumb TYTO-273 builds can read the same field for its folder part, with no channel.
- A label that is ever made a key would reopen ADR 0010's question; it is named here so that it
  is not done by accident.
- The native tooltip is drawn by the operating system, so a screenshot of the window does not
  show it; `e2e/tab-folder.desktop.test.ts` reads the attribute instead.
