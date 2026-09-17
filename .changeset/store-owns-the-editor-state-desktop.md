---
'@tyto/desktop': minor
---

TYTO-115 — the workspace owns the text, which is what unblocks two cards that could not be
written

Nothing on screen changes, and that is the acceptance criterion rather than a disclaimer:
`pnpm --filter @tyto/desktop test:desktop` passes with no test edited and none added, 76 of 76.

**Five call sites used to ask CodeMirror what the document said** — the template picker's
repaint, the save, the picker's `change` handler, the debounced compile and the first compile
on load. Each of them was therefore an answer only the _active_ document could give, because
`DocumentState.snapshot` was a copy refreshed when a document stopped being active and stale
on purpose for exactly as long as it was in front. All five read `activeText()` now, and the
recount is **0 of 5** left reading the pane. `panel.ts`'s `view.state.doc.length` stays, and
is not one of them: clamping a range before revealing it in a viewport is the view's own
question.

`DocumentState.snapshot` is replaced by two fields that are not the same thing.
`state` is the document — text, undo history and cursor — written by an `onUpdate` listener
on every transaction. `scroll` is where the pane was looking, still captured at a hand-off,
because scroll belongs to the view and two views on one document scroll independently (D7),
and because reading it costs a layout flush that a keystroke should not pay.

**Why this is a card of its own**, against the exploration's advice to fold it into a
feature: it is behaviour-preserving and its evidence is silence, while TYTO-112 deliberately
inverts an end-to-end expectation. Done together, nobody could tell which half moved that
test.

What it does not do: derive the unsaved marker (TYTO-112, which this unblocks), restore a
session (TYTO-113), or allow a second editable view on one document (D2).
