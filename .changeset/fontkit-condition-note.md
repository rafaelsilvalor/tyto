---
'@tyto/core': patch
---

Say in `face.ts` that fontkit's purity is a property of the export condition (TYTO-71).

The note there claimed `core` stays pure because "fontkit publishes a browser build through
its `exports` map", which is true and stops one step short of the thing a reader needs.
fontkit ships two builds and the map picks between them by condition; the `node` one imports
`fs`. Nothing in this file decides which is resolved, so the note now says where that
decision does live, and points at ADR 0010 and the check that measures it.

Comment only — no behaviour changes, and no call site moves.
