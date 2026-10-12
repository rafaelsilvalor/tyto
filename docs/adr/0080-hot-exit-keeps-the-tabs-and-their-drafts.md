# 0080 — Hot exit: the app keeps the tabs and their drafts, and quitting asks nothing

Status: accepted · 2026-10-11 · TYTO-113 · amends ADR 0034 (the quit box becomes a fallback),
ADR 0036 (one more record travels) and the Reload decision of TYTO-104

## Context

Closing the desktop app with four briefs open and reopening it showed one empty tab. The saved
briefs could be opened again one by one; text typed and not saved was gone unless the person
answered the quit box (ADR 0034) with _Sim_ and picked a name for every untitled tab. The same
loss is why TYTO-104 took Reload off the View menu: a reload tears the renderer down with every
document in it.

TYTO-113 asked for the window to reopen where the person left it. Rafael chose on 2026-10-11
the VS Code shape — **hot exit, with no setting**: the drafts are kept by the app, and the quit
stops asking about them.

What already existed: the workspace holds every tab's state in the store, not the view
(TYTO-115), `hasBeenEdited` says whether an untitled tab was typed in (TYTO-120), main files
every tab's path under its id (E9.11), and `layout.json` is the pattern for a record main keeps
(E9.10).

## Decision

**1. `session.json`, in the per-version data folder, written and read by main only.** Main is
the only side that knows paths (ADR 0010). The record lists the tabs in order — a kind (`brief`,
`settings`, `keybindings`), a brief's path, and, for a tab holding text that is in no file, the
text and a SHA-256 of the saved text it differs from — and the index of the tab in front. The
store copies `fileLayoutStore`: reading never fails (a missing or unparseable file is an empty
session), writing swallows the error but **answers whether it wrote**, because the quit acts on
that answer. Line endings are normalised before hashing, since CodeMirror reads CR LF as LF
(TYTO-64).

**2. Which tabs.** A tab with a file is always kept, with a draft only when it is unsaved. An
untitled tab is kept only if `hasBeenEdited` (or it holds text); the untouched tab the window
opens on is not a session. The settings and keybindings tabs are kept as a kind and reopened by
their own commands, never by path.

**3. Two channels: `session:write` and `session:read`.** The window sends ids, kinds and drafts,
never a path: main looks each id up in the table it already keeps, so a session can only name a
file main itself had open — the same containment `file:reopen` gets from the recent list. The
window writes the session one second after any change to the strip or the text (a crash costs at
most that much typing), at once on a reload, and at once on the quit, through the quit handshake
that already exists (ADR 0029, 0031, 0039 are untouched).

**4. Reading decides against the disk as it is then, in main.**

- A brief is reopened from the path main stored, under an id of main's own (`session-<n>`), and
  the path table of the page before is cleared first, since a reload reuses the window's ids.
- A draft goes over its file **only if the file still hashes to the saved text the draft was
  written against**. Otherwise the tab opens with the disk's text, clean, and the draft opens in
  a new untitled tab beside it with a `W_SESSION_DRAFT_STALE` row naming the file. The old text
  is never imposed over a newer file, and never dropped either.
- A file that is gone loses its tab and is named in an `E_FILE_NOT_FOUND` row, the notice
  `file:reopen` already gives; its draft, if it had one, comes back as an untitled tab.

**5. The quit asks nothing about drafts.** `resolveExit` writes the session first; when it was
written, the tabs' unsaved text is kept and the three-answer box of ADR 0034 is not drawn. The
box stays for two cases, because hot exit must not become a way to lose work: the template
mode's buffers, which the session does not hold, and a session the disk refused — then it asks
about every unsaved tab exactly as before. **What the removal changes:** a person who wanted to
_discard_ unsaved text on the way out now finds it again on the next launch and closes the tab
there; nothing is written into their files without them asking, because drafts live only in the
app's own folder.

**6. The settings tab's pending screen changes reach the disk at session end** (ADR 0073
decision 8). A quit calls the same `closed` path closing the tab uses, and the draft is then
hashed against the file as it was just written, since the draft already holds those changes
(TYTO-255 moved them into the buffer). A reload does not end the tab: it comes back dirty with
the changes still pending in main.

**7. Reload comes back, as the window's command.** View > Reload and `Mod-r` run
`window.reload`, which writes the session and then reloads. Not Electron's `reload` role: the
role tears the page down before it can write anything, and its accelerator would take `Ctrl-R`
from vim's redo. `Mod-r` is in the desktop keymap set, so vim mode keeps redo. Force Reload and
Close stay off the menu.

**8. The undo history does not survive** a quit or a reload. An `EditorState` is opaque
(`@tyto/editor` offers three reads of it) and none of them is a serialisation; a restored tab
starts with an empty history. Scroll and cursor position are not kept either.

**9. `session.json` joins `IMPORTED_RECORDS`** (ADR 0036, amended in place), so an update keeps
the drafts.

## Consequences

- Template-edit mode is out of the session: its two buffers are still the box's to ask about.
- A huge untitled draft crosses the bridge on every pause and lands in `session.json` whole.
  Nothing caps it; no brief this app has seen is near the size where that costs anything.
- One window, one session. A second window (ADR 0029's open bullet) would need one record per
  window.
- The quit e2e reaches the box by putting a folder where `session.json` goes, which is how a
  full disk looks to the store; what it proved about the handshake stands.
- `e2e/session.desktop.test.ts` launches one data folder four times: hot exit, restore with the
  same order, active tab and drafts, `Mod-r` mid-typing, and a deleted and a changed file.

**Note, 2026-10-12 (TYTO-250).** The final write is reached through the quit handshake, and a
page's own `window.close()` used to skip it: it fires no `close` on the window, so a draft typed
inside the one-second pause was lost. The decision stands; the handshake gained a third door
(`will-prevent-unload`, `docs/architecture.md`).
