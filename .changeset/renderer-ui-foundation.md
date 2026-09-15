---
'@tyto/desktop': minor
---

TYTO-100 — Lit for the renderer, and a window whose layout can become data

The framework question had been pushed twice with nobody owning it. It is answered in ADR
0024, with the problems panel rebuilt on the answer so that the decision ships as code and
not only as a document.

**What was measured, and what it said.** A repaint costs 4.9 ms today and 9.3 ms with ten
panels in the window, inside a 16.7 ms frame — so nothing about speed forces a framework at
the size being planned. The `[data-i18n]` walk, which the card named as the worry, is 1 % to
5 % of that; the cost is `stageBox()` forcing a synchronous layout after the other painters
have dirtied the document. What does force the change is that a panel today is a `<div>` in
`index.html` plus a `getElementById` plus a bespoke painter, and none of those three can be
written down as a record — which is what a window with panels a person shows, hides and
resizes needs a panel to be.

**Lit, over Preact and over staying hand-written.** The same panel built three ways: changing
one diagnostic of two hundred costs 1.62 ms hand-written, 1.11 ms on Preact and 0.14 ms on
Lit, and both component models keep the DOM nodes of the rows they did not change where
`replaceChildren` could not. Lit also needs no build knob — no JSX transform in the three
configs that declare this package's two-runtime split — and renders into light DOM, so
`shell.css` still reaches inside every panel.

**`<tyto-problems>` replaces `paintProblems`.** It owns its own strings, so changing the
locale is a property change rather than a second pass over the document, and it hands a
clicked row's range straight to the callback — the two `data-range-*` attributes and the
`closest()` that parsed them back out are gone. Rows are keyed by the diagnostic's code and
span and never by index, so fixing one error does not repaint the ones below it.

**The renderer will not run in a browser tab.** Five comments said it would; ADR 0024 retires
that premise and says what replaces each of them. A template's `preview.png` still crosses
the bridge as bytes and `window.tyto` is still optional, for reasons that never depended on
it. The window still has a browser tab's powers and not a Node process's, and the pure
packages still run in any runtime — those two are untouched, and they are the ones that
actually make the cloud possible.

The bundle grows 24.8 kB, or 2.3 %, on a renderer CodeMirror already dominates.
