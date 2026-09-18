---
'@tyto/desktop': minor
---

TYTO-43 — the window exports.

An export dialog with a destination folder, file types, a progress bar, cancel and "open
folder", running the same `runJob` the CLI runs. Measured rather than asserted: the same
brief rendered through the window and through `tyto render` produces byte-identical
artifacts (`e2e/export.desktop.test.ts`).

Progress is polled rather than pushed. Every channel in `shared/ipc.ts` is a question with
an answer, and the one-way main→renderer message a push would need is the transport TYTO-123
has to design for its quit confirmation — so this card asks instead of deciding that for
another card.
