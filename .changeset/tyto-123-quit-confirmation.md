---
'@tyto/desktop': minor
---

TYTO-123 — quitting with unsaved tabs asks first, and a no keeps the app open.

Closing a single tab with unsaved text already asked. Closing the window asked nothing: every
open tab went, unsaved ones included. Both doors are now guarded — the window button and
`Mod-W` through `BrowserWindow.on('close')`, Cmd+Q and the dock's Quit through
`app.on('before-quit')` — sharing one latch, so one click produces one question. The box names
how many tabs would be lost, in the window's own language, with the cancelling button as the
default.

This is also the card that gave the app its first main→renderer message (ADR 0029). Main could
answer before; it could not speak first. There is now a second table, `IPC_EVENTS`, one-way,
and the rule that **a push carries no reply** — when an answer is needed it comes back on an
ordinary request channel. `export:progress` keeps polling on purpose: progress is state a
dialog reads, not a question that needs answering.

One case still loses work, deliberately: a renderer that never answers holds the app open for
two seconds and then the exit proceeds. An app that cannot be closed is worse than the loss it
would have reported, and ADR 0029 records the trade.
