---
'@tyto/desktop': minor
---

TYTO-101 — the dock: a panel is a record, and a person can show, hide and resize it

The window used to be a room with the furniture nailed to the floor. `index.html` declared
an editor on the left, a preview on the right and a problems panel underneath, and `main.ts`
held fifteen `getElementById` calls resolved before anything was on screen — which is exactly
what stopped a panel from ever having a position that could change.

**Now nothing in the markup says where a panel goes.** `index.html` declares four empty docks
and a splitter each; `shared/layout.ts` holds one entry per panel — which element, which
dock, open or not, how wide — and the dock builds the window from it. Adding the templates
list or the queue is an entry and an element, with no change to the dock, the stylesheet or
the window. The left dock is already there and empty for exactly that reason.

**What a person gets:** a close button on every panel that has one, the same panels back from
the command bar (`Mod-K`, "Mostrar ou esconder: Problemas"), and a splitter to drag between
any two docks. All of it is remembered — close the problems panel, drag the preview wider,
quit, reopen, and the window comes back the way it was left. "Restaurar a disposição padrão"
is a command rather than a button, so it is reachable with every panel shut, which is when it
is most needed.

**The editor cannot be closed, and that is a field rather than a rule.** Closing its panel
unmounts CodeMirror and destroys the buffer; E9.8 gave it somewhere to save to but nothing
asks before discarding, and there is still no second tab to keep it in. When either lands,
`fixed: false` is the whole of the change.

Two things were found by opening the window rather than by a test, which is now the fourth
time on this app. Sixty-four pixels of dead space between the panes and the bottom dock,
because the shell's own 24px gap was still being added on both sides of a 16px splitter. And
`Mod-K` stopped opening the command bar after the first time a panel was closed: the window
listener was being registered again on every rearrange, so two of them toggled the bar twice
inside one keystroke and it never appeared.

The repaint measurement from ADR 0024 was re-run against the real panels and the ADR now
carries both numbers. The conclusion holds — the forced layout is the expensive half and the
`[data-i18n]` walk is not — and the magnitudes were overstated: the synthetic document had
944 elements where the real window has 115.
