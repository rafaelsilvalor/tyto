---
'@tyto/desktop': patch
---

TYTO-147 — quitting with unsaved tabs now waits for you to answer the box, however long you take,
instead of taking your work two seconds after showing it to you.

The quit question was guarded by a single two-second timer, and when it fired it did not cancel the
question — it _was_ the exit. The box that asks is drawn by main with `dialog.showMessageBox` and
the window sends its answer only after somebody clicks, so what those two seconds bounded was never
a renderer computing anything. It was a person reading. Anybody who read the box before choosing
lost every unsaved tab at the two-second mark, which is the ordinary case and not a rare one.

The wait is in two stages now. The window acknowledges the question on a new `app:exit-ack` channel
as the first thing its listener does — before it counts unsaved documents and before anything is
drawn — and a deadline bounds that acknowledgement and nothing else. A window silent that long is
genuinely wedged, and the app still gets out. After the acknowledgement there is **no deadline at
all**, because the thing on the other end is a person.

**That deadline is five seconds, and keeping the old two was tried first.** The round trip it has
to cover measures 0-2 ms on an idle machine and 44 ms at the worst of twenty, so two seconds read
as ample headroom — but the new end-to-end case, the one that answers the box slower than the
deadline, failed 3 runs in 13 against a built app, every failure the app exiting at ~2.02 s with
the acknowledgement not yet back. A budget a real launch misses about a fifth of the time is this
same bug with a smaller window, so the budget moved rather than the test, and a unit test now pins
the number so it cannot drift back to a guess on a green suite.

What ends the unbounded wait when the page that was asked goes away is a hard check and not a
second, longer timer: a crash, the window closing and a reload all release the exit. The reload is
the one worth naming — it keeps the renderer process and throws away the page holding the question,
and without it a single reload with the box up left an app that could never be quit again. A second
number would have been picked the same way the first one was, and a dead renderer's unsaved text is
already gone, so holding the app open would protect nothing. ADR 0031 records that, the rejected
alternative, and the one counter-argument — an OS logoff is now bounded by the OS rather than by us.

**Correcting the 0.3.0 entry below rather than rewriting it.** That entry says "a renderer that
never answers holds the app open for two seconds and then the exit proceeds", and ADR 0029 said the
same. Both name the wrong case: the timer was not catching wedged renderers, it was catching
readers. The published note is the shipped record of a version that was built and tagged, so it
stays as history and the correction arrives here, where it is auditable; ADR 0029 carries the same
correction as an amendment, in the form ADR 0027 already uses.

No test in the repository could see any of this, because every one of them replaced the box with an
already-resolved promise and answered in microseconds. There is now an end-to-end case that takes
four seconds to answer and looks at the app at three — the only test here that fails against the
shipped behaviour.
