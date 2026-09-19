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
2. `ackTimeoutMs` bounds that acknowledgement and nothing else. What it is pointed at is a push
   reaching a listener that is already registered and one `invoke` coming back. A window silent
   that long is genuinely wedged, and the old argument — an app that cannot be closed is worse than
   the loss it would have reported — holds for it unchanged.
   **The number is 5000, and the first one tried was the old 2000.** Keeping two seconds looked
   free: the round trip measures 0-2 ms idle and 44 ms at the worst of twenty, so it read as 45x of
   headroom. It was not. The new end-to-end case — the one that answers the box slower than the
   deadline — failed **3 runs in 13** against a built app, every failure the exit firing at
   ~2.02 s with the acknowledgement simply not back yet. A budget a real launch misses about a
   fifth of the time is this card's own bug with a smaller window, so the budget moved and the test
   did not. Five seconds is ~113x the worst round trip measured; what it costs is three further
   seconds before a wedged window lets go, which is the cheap side of that trade.
   **What a `setTimeout` can actually measure is narrower than that, and the difference is
   recorded in the Consequences rather than papered over**: main runs the clock, so it bounds
   main's own availability too.
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
root wires it to three events: `webContents.on('render-process-gone')` (a crash or a kill),
`BrowserWindow.on('closed')` (the window going away by any other route) and a main-frame
`did-start-navigation` that is not same-document (**a reload**, which keeps the renderer process and
throws away the page that had the question). `windowGone` delegates to the existing `release()`,
which returns early when nothing is outstanding, so on every ordinary quit — and on the first load —
they fire and do nothing.

**The third one was missed first, and the app it shipped could never be quit again.** With only the
first two hooked, one `page.reload()` while a box was up left `pending` set with no event able to
clear it: every later `app.quit()` refused, the X button refused with it, and no question ever asked
again. Measured against the built app on this branch, and reachable in the shipped build — `menu.ts`
keeps `toggleDevTools`, and reloading from there is the premise of TYTO-104. A reload takes every
unsaved document with it, so `windowGone`'s own argument covers it: there is nothing left to protect.

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
macOS restart, and the unbounded wait — item 3 of the Decision above — now prevents those with no
deadline of our own. That is bounded in practice by the OS, which force-kills after its own timeout
— **asserted from general knowledge and not measured here**, and it is the strongest case for the
rejected option. It does not change the
answer, because a second timer short enough to beat a logoff is a second timer short enough to take
a person's tabs, which is the bug.

`windowGone` deliberately calls `release()` rather than setting `confirmed` itself. Setting the
latch directly would make the next quit ask nobody at all — TYTO-123's bug, restored, and with the
whole suite still green. `src/main/quit.test.ts` has a case whose only job is that distinction.

## Consequences

- **The app no longer has a clock over a person.** The one path where TYTO-123's guarantee did not
  hold is closed, for as long as the page that was asked is the page still on screen. A window that
  is alive but has _navigated_ is not that page, and it is released rather than waited for.
- **The deadline bounds main's own availability, not the window's, and that is the residue of this
  card.** `setTimeout` runs on main's event loop: block main past the deadline and the callback runs
  the moment it is free, with the acknowledgement queued behind it and unread, releasing the exit
  on the strength of main's stall. **Measured** against the built app — main's loop blocked for
  2.5 s while the renderer answered normally, and the app quit and took the tab. The same holds for
  a renderer stalled that long before it can reach its own listener. What is _not_ at risk is
  ordinary work: 20 quits on an idle machine put the whole renderer round trip at 0-2 ms, 44 ms at
  the worst, which is 45x of headroom, so what is left is a machine-level pause and not a slow
  window. A fix would need a liveness question main can ask at the moment the clock fires, which is
  a port the guard does not have and a card this one does not open.
- **A re-armed clock was tried for that and rejected, measured.** Re-arming the deadline whenever
  its callback comes back more than half of it late covers a long main stall and nothing else: the
  2.5 s stall above is inside the ratio and still takes the tab. The reds that prompted the attempt
  — the new e2e case failing 3 times in 13 on a reviewer's machine, and not once in 10 here —
  released at ~2.02 s, which is a clock that was **not** late and therefore nothing a re-arm can
  see. The alternative, a slack tight enough to catch ordinary jitter, is a clock that re-arms
  forever against a genuinely wedged window — the hang this ADR spent its open question avoiding.
  What those reds did settle is that two seconds was the wrong budget, which is why the number
  moved to five and is now pinned by a unit test rather than by a comment.
- **A wedged window still cannot hold the app hostage**, and it now takes five seconds rather than
  two to establish that. What changed is what those seconds are pointed at, and how many of them
  a launch is allowed to spend before the app decides nobody is listening.
- **A push that needs an answer may now need two return legs**, and ADR 0029's correlation-id rule
  covers both: `acknowledge` and `answer` each ignore an id that is not the outstanding question, a
  stale ack being exactly as dangerous as a stale yes. A later card adding an expensive question
  has a shape to copy.
- **The composition root now hears about the window dying**, which it did not before — the only
  liveness main had was `isDestroyed()` taken at send time. That is three listeners in `index.ts`
  and nothing in `quit.ts`, which still imports no Electron.
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
