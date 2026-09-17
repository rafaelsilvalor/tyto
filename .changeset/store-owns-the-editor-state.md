---
'@tyto/editor': minor
---

TYTO-115 — a host can hold the document, and the view becomes a viewport onto it

`EditorHandle` stops handing out an opaque `DocumentSnapshot` and hands out the thing itself.
`state()` is the document of record, `onUpdate` delivers the state of every transaction, and
`textOf(state)` reads a document without a view — which is the point: a host with tabs can
now answer "what is in this buffer" for every buffer it holds rather than only for the one
CodeMirror happens to be showing.

**The order inside the update listener is the mechanism, not a detail.** `onUpdate` fires
before `onChange`, so a host that reads its own store from `onChange` finds the text of the
transaction that has just run. Both listener sets live in one `EditorView.updateListener` for
that reason; two of them would leave the order to the extension array. Perturbing it — the
store told last — fails two unit tests here and five end-to-end tests in the desktop.

**Breaking, and the migration is four names.** `snapshot()` becomes `state()`, the scroll it
used to carry comes from `scroll()` on its own, `restore(snapshot)` becomes
`restore(state, scroll?)` with the scroll optional, and `blank(doc)` returns an `EditorState`
rather than a pair. `EditorState` and `ScrollPosition` are re-exported so a host still
declares no `@codemirror/*` dependency to name what it is holding.

`getValue()`, `setValue` and `onChange` are untouched: a host without tabs never needed any
of this and still does not.
