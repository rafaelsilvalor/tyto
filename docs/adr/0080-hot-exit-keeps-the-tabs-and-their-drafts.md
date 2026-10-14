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
text and a SHA-256 of the saved text it differs from — and the index of the tab in front.
_Amended by TYTO-266:_ and, when the template mode is open on a markup folder, an optional
`template` — the folder, which buffer is in front, and a draft per buffer that holds unsaved text,
in the same text-and-hash shape. A mode open with nothing unsaved is kept too, and reopens. The
field is optional and the version stays 1, so a file written before it (and one an update imports,
decision 9) reads as a session with no template mode rather than as an empty one.
_Amended by TYTO-265:_ and, per tab, an optional `place` — the main selection's `anchor` and
`head` and the `top` of the pane, all document offsets — under the same rule: optional, version
still 1, and a `place` that does not parse is dropped alone rather than costing the session.
_Amended by TYTO-286:_ and an optional `groups` — the editor groups of ADR 0083: the tree of
splits, each with its direction and its children's shares, each leaf a group whose tabs name a
session tab **by index** with that tab's own `place`, the index of the tab in front, and which
leaf was focused, counted in tree order. `tabs` stays the list of documents, one draft each, and
`active` keeps naming the **focused group's** document, so a build that does not know `groups`
(zod strips the key) still restores every tab, as one group, with the right one in front. The
version stays 1, and a tree that does not parse is dropped alone (`.catch`): it costs the
arrangement, never the drafts. On the wire the window names a group's tab by its document id;
main turns it into an index of the tabs it keeps, and a group left with none goes.
_Amended by TYTO-287:_ a group's tab may be a preview (ADR 0084): `{ view: 'preview' }` for the
following one, which names nothing, and `{ tab, view: 'preview', locked: true }` for one locked on
the brief at that index; neither keeps a `place` or a path, and a locked preview whose brief was
not kept or did not come back goes. **`groups` is now always written** — one empty group when
nothing is kept — because a session without it is how a launch knows it is the first one, and
`session:read` answers `firstLaunch` from that. The
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
- _Amended by TYTO-286:_ with groups, a stale draft opens beside its file's first tab, in the
  same group; a group whose tabs all failed to come back collapses, and a tab no group names
  goes into the focused group.

**5. The quit asks nothing about drafts.** `resolveExit` writes the session first; when it was
written, the tabs' unsaved text is kept and the three-answer box of ADR 0034 is not drawn. The
box stays for one case, because hot exit must not become a way to lose work: a session the disk
refused — then it asks about every unsaved tab, and the template mode's buffers, exactly as
before. _Amended by TYTO-266:_ the box used to stay for the template mode's buffers too, which
the session did not hold. It holds them now, decided like a brief's: the window sends the buffers
and never the folder — main files the folder `template:open` last read, as it files a brief's
path (decision 3) — and on the next page main reads the folder again, puts a draft over its file
only if the file still hashes to what the draft was written against, and otherwise opens the
disk's text with the draft in an untitled tab beside it and a `W_SESSION_DRAFT_STALE` row naming
`<folder>/template.html` or `manifest.yaml`. A folder that is gone is `E_FILE_NOT_FOUND`, and its
drafts come back as untitled tabs. Two consequences follow: closing the mode and confirming
_Discard_ now really drops its drafts, since a closed mode is not in the session; and the sample
brief picked in the mode is not kept. **What the removal changes:** a person who wanted to
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
(`@tyto/editor` offers reads of it) and none of them is a serialisation; a restored tab starts
with an empty history. _Amended by TYTO-265:_ scroll and cursor position were not kept either,
and now are. The window reads the main selection off each tab's state (`selectionOf`) and the
offset of the line at the top of its pane (`ScrollPosition`, plain data since then) — for the
tab in front measured at the write, for a tab behind it the scroll it had when it was last in
front — and puts them back after the tab's text is in place, clamped to that text
(`withSelection`, and the editor clamps the scroll), because the file may have changed on disk
or got shorter. A tab whose draft went stale gives its place to the disk's text, clamped, and to
the draft beside it. An offset and not a pixel, because a pixel names another line in a window
of another width: measured on a brief whose lines wrap, the same `scrollTop` of 3046 px was line
41 at a 705 px pane and line 27 at 325 px. Only the main selection is kept, and the template
mode's buffers keep neither. _Amended by TYTO-286:_ a document shown in two groups looks at two
places, so each group's tab carries its own `place` in `groups`; the tab-level `place` is the
document's, which is its primary pane's. On the next launch each tab is put back where it was
the first time a pane shows it, after the group elements have rendered, and a tab behind
another in its group is written from where it was when its pane last let go of it. The undo history stays out. CodeMirror can write it down
(`toJSON` with its `historyField`), but what it writes is valid only against the exact text it
was recorded on, so every draft that went stale or file that changed would have to drop it, and
it grows with every edit since the tab was opened, into a file that crosses the bridge each
second of typing and that an update imports. Not cheap enough to ride on this card.

**9. `session.json` joins `IMPORTED_RECORDS`** (ADR 0036, amended in place), so an update keeps
the drafts.

## Consequences

- Template-edit mode is in the session since TYTO-266 (decision 5): its two buffers are the box's
  only when the session could not be written.
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
