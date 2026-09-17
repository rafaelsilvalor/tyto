# 0026 — The unsaved marker is a comparison, and a tab with no file compares against nothing

Status: accepted · 2026-09-17 · ratifies D3 of `docs/explorations/2026-09-16-document-buffer-model.md`

## Context

A tab in the desktop window shows a dot when it holds text that is not in a file, and the
window title says `(não salvo)` for the same reason. Until now that was a stored boolean on
`DocumentState`, set in four places by hand: `newDocument` wrote `false`, the first keystroke
wrote `true`, a save wrote `false`, and `releaseDocument` wrote `true` (TYTO-104).

A flag that one code path sets and another clears is wrong exactly when the two disagree, and
this one had a visible case: typing a character and undoing it took the text back and left the
dot on. `e2e/tabs.desktop.test.ts` pinned that deliberately — _"the undo above took the text
back but not the fact that somebody edited the buffer"_ — so it was behaviour and not a bug
report, but it is behaviour nobody would choose.

D3 of the exploration says the marker should be derived, `!doc.state.doc.eq(doc.savedDoc)`,
and never stored. That note is explicitly not binding, and it leaves one question open that
this repository has already created an answer for and has to live with: **a tab that lost its
file is unsaved in relation to what?** `releaseDocument` takes the path off a tab whose file
another tab just saved over (TYTO-104, `docs/architecture.md`). Under a comparison there is
nothing on disk left to compare against.

Deriving it also became possible only recently. The store did not hold the text of the
document in front — the editor did — so a comparison would have read a snapshot that was
stale for exactly as long as the tab was visible. TYTO-115 (D1) moved the `EditorState` into
the workspace, written by an update listener on every transaction.

## Decision

`DocumentState.dirty` is deleted. `DocumentState.savedText: string` takes its place, and the
marker is `contentOf(document) !== document.savedText`, computed on every read.

**`savedText` is the empty string for a document that is in no file at all**, and that is one
rule rather than a special case. It covers three states with the same comparison:

- the untitled tab the window opens on — empty buffer, empty saved text, clean;
- a tab typed into and then emptied again — clean, because there is nothing in it;
- a **released** tab (TYTO-104) — unsaved for as long as it holds a character, clean when it
  holds none.

`savedText` is written in exactly three places, and each is a moment when the document and a
disk agreed: `newDocument` (nothing, in no file), a file arriving through `file:open` or
`file:reopen`, and the string `file:save` reports having written. `releaseDocument` empties
it. Nothing else touches it, and nothing anywhere sets a marker.

**The file's text is read back out of the buffer, not taken from the bytes.** CodeMirror
normalises line endings when it builds a document, and a CR LF brief is a supported input
(TYTO-64, and `tools/contract-test/src/fixture/line-endings/` is a committed one). Comparing
the buffer against what main read off the disk would therefore mark every such file unsaved
the instant it opened, and put a discard dialog in front of closing it, for a difference the
app cannot keep: a save writes the buffer. The marker means "text you would lose".

**A string and not CodeMirror's `Text`**, which is the type D3 names. `textOf` is the only
read `@tyto/editor` offers and a `Text` is not reachable through it; it is also not wanted,
because both ends of the comparison cross the bridge as strings — `openDocument.text` in
`shared/ipc.ts` is what main read off the disk and what main says it wrote. The rule D3 states
survives; the type it states does not.

### The two shapes that were rejected

**Keep the old saved text on a released tab**, so it is clean while its buffer still equals
what used to be on that path. Cheapest to implement and the one that loses work: the text at
that path is gone — the other tab overwrote it — so the tab is clean against a string that
exists on no disk anywhere, `requestClose` asks no question, and closing it drops somebody's
brief in silence. It also makes one tab's marker depend on another tab's writes, which
contradicts _"Exactly one tab holds a path"_.

**Make `savedText` null and read "no file" as always unsaved**, which is what the hand-written
`dirty: true` did before this change. It needs a second concept the moment it is written down: the tab the
window opens on has no file either and must be clean, or `isDisposable` refuses to replace it
and every first file opens in a second tab. That second concept — "had a file and lost it" —
is a boolean set by one code path and read by another, which is the thing this ADR removes.

## Consequences

**An empty tab in no file is disposable however it got that way, where before only the
window's opening tab was.** `isDisposable` is now `name === undefined && !isUnsaved(document)`,
so a tab that was typed into and then emptied — or that held a file, was emptied and then
released — can be replaced by the next file opened instead of being pushed aside. It is
reached only for the document in front, and an active, unnamed, empty tab is the scratch tab
whatever it used to hold.

**What that costs is not only the tab, and the honest statement is worth making.** The buffer
holds nothing, but the `EditorState` being dropped still holds the **undo history**, so the
paragraph somebody typed and deleted stops being recoverable at the moment the next file is
opened. Under the stored flag that tab was `dirty: true` and survived. The precise question
`isDisposable` wants is "has anything ever been typed here", which is `undoDepth(state)` —
a second read from `@tyto/editor`, whose surface is deliberately one function today, and
therefore a decision of its own rather than a line in this card.

**`isDisposable` lost a third clause rather than keeping one that stopped being true.** It
also required `brief === ''` — the last compiled text — because text put into a buffer
without a keystroke notified nobody and the stored flag could be false with a whole brief in
the tab. A comparison cannot be wrong about that. The clause going means a tab whose buffer
was emptied is disposable even while its last compile still says something, which is the
buffer's answer and the right one.

**A save records what main says it wrote, not what the buffer says afterwards.** A save-as
puts a dialog in front of somebody who can go on typing behind it, so `savedText` takes
`answer.document.text` — the string `file:save` echoes back after writing it. The old
`dirty: false` called those extra characters saved.

**The repaint lost its edge.** A flag flips once; a comparison flips back, so there is no
first keystroke to watch for. The tab strip and the window title are repainted on every edit
instead, and the `[data-i18n]` walk over the whole window stays out of that path.

**Two end-to-end expectations invert**, which is where the change is measured.
`e2e/tabs.desktop.test.ts` typed into two tabs, undid one of them, and expected both marked;
it expects one now. The test after it saved the other tab and expected the undone one still
marked; it expects nothing marked now. The dot is also the only instrument the suite has for
_"the undo restored the file's text exactly"_ — `.cm-content` holds the viewport, so a
four-hundred-line brief cannot be compared any other way.
