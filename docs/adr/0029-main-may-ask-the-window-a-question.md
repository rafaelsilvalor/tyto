# 0029 — Main may ask the window a question, and a push carries no reply

Status: accepted · 2026-09-18 · decided by TYTO-123 · amended by ADR 0031, which corrects the trade recorded in the Consequences below

## Context

Every message in `apps/desktop/shared/ipc.ts` was a question the renderer asks. The preload
exposed `ipcRenderer.invoke` and nothing else, and the table was one list of request/response
pairs. Main could answer; it could not speak first.

Three code comments and a changeset had already noticed this and deferred the decision to
TYTO-123 by name, which is how a transport choice ended up owned by a card about quitting:

- `shared/ipc.ts`, on `export:progress` — the dialog polls because a push was a shape the app
  did not have.
- `src/main/export.ts` and `src/renderer/export-dialog.ts` — the same claim, twice more.
- `.changeset/tyto-43-export-dialog.md`.

`docs/architecture.md` said it too, as the reason TYTO-104 took the Reload accelerator off the
menu instead of guarding it: _"a prompt from a menu click would need a message travelling the
other way, which this app has none of."_

TYTO-123 forced it. Quitting with unsaved tabs has to ask, and main cannot answer the question
itself. The workspace is the renderer's; `isUnsaved` is a comparison computed from it and never
a stored flag (ADR 0026); and the language the question has to be asked in is whatever the
footer picker last chose, which the renderer changes at runtime and main was told exactly once,
at startup, as `localeFor(app.getLocale())`.

## Decision

**A second table, `IPC_EVENTS`, one-way, main → renderer. A push carries no reply.**

The renderer subscribes through `bridge.on(name, listen)`, which the preload builds from the
event table the way it builds the channel methods from the channel table. When a push needs an
answer, the answer travels back on an **ordinary request channel** — `app:exit-requested` is
answered by `app:exit-answer` — so the app gained one new transport shape rather than two, and
correlation, timeouts and failure modes stay in one direction.

Both sides validate. Main validates before sending, so it cannot put a shape on the wire the
preload will refuse; the preload validates on arrival, because a renderer may not trust another
process however typed it looked at compile time. `IpcContractError` carries `'event'` as a third
direction rather than reusing `'request'`: naming a direction is how the error says whose bug it
is, and a bad push is main's.

### The alternative that was rejected

**The renderer pushes a dirty count into main, and main asks its own question.** It invents no
direction, which was its whole appeal. It was rejected on the locale: main would have to hold a
copy of the count _and_ the window's current language _and_ keep both fresh, which is three
pieces of renderer state instead of one. It would also need a second dialog beside the `confirm`
dependency the tab question already uses, so "the safe button is the default" would be a copy
that has to be kept in step rather than a property inherited by construction.

## Amended by ADR 0031

One bullet in the Consequences below is wrong as written, since 2026-09-19. Verbatim:

> **The exit can still lose work, in one case, on purpose.** A renderer that never answers holds
> the app open for two seconds and then the exit proceeds. That trades "lose the unsaved text of a
> window that is already wedged" against "an app that cannot be closed", and the second is worse.
> It is the only remaining path where TYTO-123's guarantee does not hold.

**The case it names was not the case the timer caught.** It describes a renderer that never
answers; what the two seconds actually bounded was a **person reading the box** — drawn by main
with `dialog.showMessageBox` at `src/main/index.ts`, answered only after a human clicks — so every
quit where somebody read before choosing lost every unsaved tab at the two-second mark. Not an edge
case and not a wedged window: the ordinary one (TYTO-147, severity Alta).

The deadline now bounds an **acknowledgement** and nothing else, and the wait for the answer has no
deadline at all. What ends that wait when there is nobody left to wait for is the window dying, not
a clock. ADR 0031 has the shape, the rejected alternative and the argument.

Everything else here stands: the one-way `IPC_EVENTS` table, the rule that a push carries no reply,
both-sides validation, `'event'` as a third direction, the rejected dirty-count alternative and the
`export:progress` bullet are untouched. The correlation-id bullet is in fact strengthened — there
are now two return legs carrying `askId`, and both are checked against the outstanding question.

## Consequences

- **Main may now tell the window things.** The next card that wants to does it by adding one key
  to `IPC_EVENTS`, not by inventing a mechanism.
- **The reply is not part of the mechanism.** A push that needs an answer declares its own
  answering channel, and carries a correlation id the way `brief:preview` carries `requestId` —
  a prevented quit that is answered late must not release a later one.
- **`export:progress` stays polled.** Progress is state a dialog reads rather than a question
  that needs answering, and a dialog opened mid-run would have to ask once to catch up anyway.
- **The exit can still lose work, in one case, on purpose.** A renderer that never answers holds
  the app open for two seconds and then the exit proceeds. That trades "lose the unsaved text of
  a window that is already wedged" against "an app that cannot be closed", and the second is
  worse. It is the only remaining path where TYTO-123's guarantee does not hold.
- **The guard holds one window and one outstanding question.** Nothing opens a second window
  today. A card that does would have to decide whether every window is asked, or only the one
  being closed; today it would silently ask the first.
- **`TytoBridge` is no longer exactly the channel table.** `on` is the one member that is not a
  channel, and `src/preload/bridge.test.ts` is the only place in the repo that enumerates the
  object — it pins the difference rather than hiding it.
