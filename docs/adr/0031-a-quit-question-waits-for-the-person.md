# 0031 — A quit question waits for the person, and only the delivery has a deadline

Status: accepted · 2026-09-19 · TYTO-147 · amends the exit bullet of ADR 0029

## Context

ADR 0029 gave main a way to ask the window a question and TYTO-123 asked the first one: closing
with unsaved tabs. The exit is prevented, `app:exit-requested` is pushed, and `app:exit-answer`
comes back. One number guarded the whole exchange — `timeoutMs = 2000` in `src/main/quit.ts`, armed
when the question went out — and when it fired it did not cancel the question. It **was** the exit:
`release` sets `confirmed = true` and calls `resume`, which is `app.quit()`.

The comment defending the number said the renderer's part was "a filter over an array and an OS
dialog: a window that has not answered by then is not slow, it is wedged." The second half of that
sentence is not the renderer's part at all. `dialog.showMessageBox` is called **in main**, with no
parent window, and the renderer sends its answer only in the `finally` of the `await` on it. So the
answer cannot exist before a human has clicked, and the two seconds were never measuring a
renderer. They were measuring somebody reading.

The box says how many tabs would be lost. Reading it is the correct behaviour, and it is the one
the app punished: two seconds after the box appeared, the app quit and took every unsaved tab.
Every time, for anybody who read before clicking. ADR 0029 recorded this as a deliberate trade
against a wedged renderer, and that is the sentence this ADR corrects.

Nothing in the repository could see it. `e2e/quit.desktop.test.ts` replaced the box with
`Promise.resolve({ response })`, which answers in microseconds, so the timer never ran out in any
test and the suite was green over the whole of it.

## Decision

**Two stages. The deadline bounds the delivery; the answer is not timed at all.**

1. The renderer acknowledges on a new channel, `app:exit-ack`, **as the first statement of the
   `app:exit-requested` listener** — before it counts unsaved documents, before it reads the
   locale, before anything is drawn. The acknowledgement carries the `askId` and no verdict.
2. `ackTimeoutMs`, still 2000, bounds that acknowledgement and nothing else. What it now measures
   is a push reaching a listener that is already registered and one `invoke` coming back. A window
   silent for two seconds of that is genuinely wedged, and the old argument — an app that cannot be
   closed is worse than the loss it would have reported — holds for it unchanged.
3. Once acknowledged, the guard clears the timer and waits **with no deadline**, because what it is
   waiting for is a person.

**The acknowledgement is sent from the renderer's own listener, not from the preload.** The preload
could speak a beat earlier and would look more robust, but it would prove only that the renderer
_process_ is alive: a page whose script had thrown would still acknowledge, and main would then
wait forever for an answer nobody was going to write. The listener proves the thing the guard
actually needs to know — JS in that window is running and has the question.

### The open question TYTO-147 left, and the position taken

Removing the deadline creates a hang that the deadline used to cover: a window that acknowledges
and then **dies** leaves `pending` set forever, and `mayExit` returns `false` for as long as a
question is outstanding — so the app would not only stay up, it could never be quit again. Two
answers were available.

**Chosen: a hard "the window is gone" check.** The guard gains `windowGone()`, and the composition
root wires it to `webContents.on('render-process-gone')` and `BrowserWindow.on('closed')` — a crash
or kill, and the window going away by any other route. Electron 44.3.0 carries both. `windowGone`
delegates to the existing `release()`, which returns early when nothing is outstanding, so on every
ordinary quit both events fire and both do nothing.

**Rejected: a second, much longer deadline.** It was rejected on three counts.

- **It would be a number picked the same way the two seconds was** — by guessing at how long a
  person might take — and that is the exact mistake this ADR exists to undo. Any number large
  enough to be safe (an hour? a working day?) is a number that has stopped bounding anything, and
  any number small enough to bound something is a number that will take somebody's work.
- **The guard already has this rule, and this predicate.** `send` returns `false` when the
  webContents is gone or destroyed, and `mayExit` then latches and lets the app out: "nobody to
  ask, so go" is decided policy in this file already. A window that died after acknowledging is the
  same situation one beat later, and the same policy should reach it.
- **It fails closed in the right direction.** A dead renderer's unsaved text died with it. Holding
  the app open protects nothing, so there is nothing to buy with the extra time.

The counter-argument, recorded because it is real: `before-quit` is also a Windows logoff and a
macOS restart, and stage three now prevents those with no deadline of our own. That is bounded in
practice by the OS, which force-kills after its own timeout — **asserted from general knowledge and
not measured here**, and it is the strongest case for the rejected option. It does not change the
answer, because a second timer short enough to beat a logoff is a second timer short enough to take
a person's tabs, which is the bug.

`windowGone` deliberately calls `release()` rather than setting `confirmed` itself. Setting the
latch directly would make the next quit ask nobody at all — TYTO-123's bug, restored, and with the
whole suite still green. `src/main/quit.test.ts` has a case whose only job is that distinction.

## Consequences

- **The app no longer has a clock over a person.** The one path where TYTO-123's guarantee did not
  hold is closed, and the guarantee is now unconditional for a window that is alive.
- **A wedged window still cannot hold the app hostage**, and it is the same two seconds as before.
  What changed is what those two seconds are pointed at.
- **A push that needs an answer may now need two return legs**, and ADR 0029's correlation-id rule
  covers both: `acknowledge` and `answer` each ignore an id that is not the outstanding question, a
  stale ack being exactly as dangerous as a stale yes. A later card adding an expensive question
  has a shape to copy.
- **The composition root now hears about the window dying**, which it did not before — the only
  liveness main had was `isDestroyed()` taken at send time. That is two listeners in `index.ts` and
  nothing in `quit.ts`, which still imports no Electron.
- **A test that answers a box instantly proves nothing about a box.** The new e2e case takes four
  seconds to answer and looks at the app at three, which is the only test in the repository that
  fails against the shipped 0.3.0 behaviour. Wide margins and no stopwatch assertions: what it
  asserts is that the window still answers and still holds its text, never that something happened
  at a particular instant.
- **The bug was never reproduced against the packaged 0.3.0 app by hand.** It is established by the
  three legs of the code and by the e2e case above failing when the acknowledgement is removed. The
  field report in TYTO-147 is the only observation of a person meeting it.
- **The quit question still covers one window.** ADR 0029's bullet about a second window is
  untouched and still unanswered.
