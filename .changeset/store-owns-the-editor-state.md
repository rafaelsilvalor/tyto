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
rather than a pair. `EditorState` and `ScrollPosition` are exported so a host still declares
no `@codemirror/*` dependency to name what it is holding.

**`EditorState` is exported as a local alias, not as `export type { EditorState }`**, and the
difference is not style. The re-export form reads correctly in the source and comes out of
tsup's declaration rollup as `export { EditorState } from '@codemirror/state'` with the
`type` modifier dropped — so the published `.d.ts` promised a value the bundle does not carry,
a consumer writing `import { EditorState } from '@tyto/editor'` typechecked clean and failed
at link time. Measured on the built `dist/`, fixed by `export type EditorState = …`, and the
probe now stops at `TS2693: 'EditorState' only refers to a type`.

**The scroll hand-off is asserted on the effect, because nothing else could.** jsdom has no
layout, and the end-to-end suite turned out not to cover it either: with `restore` changed to
drop the scroll it was given, `e2e/tabs.desktop.test.ts` passes 17 of 17, because restoring
the selection scrolls the view to the caret and that satisfies its `scrollTop > 0`. The new
unit test watches the effect reach a transaction through an ordinary listener, and fails on
that mutation.

`getValue()`, `setValue` and `onChange` are untouched: a host without tabs never needed any
of this and still does not.
