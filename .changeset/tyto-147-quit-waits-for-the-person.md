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
drawn — and the two seconds bound that acknowledgement and nothing else. A window silent that long
is genuinely wedged, and the app still gets out. After the acknowledgement there is **no deadline
at all**, because the thing on the other end is a person.

What ends the unbounded wait when the window dies mid-question is a hard check and not a second,
longer timer: `render-process-gone` and the window's own `closed` both release the exit. A second
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
