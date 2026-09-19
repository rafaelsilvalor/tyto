---
'@tyto/desktop': patch
---

TYTO-148 — an export that cannot capture a frame now says so and finishes, instead of sitting at
eleven frames of twelve forever.

Nothing in the desktop's capture path had a clock. The five steps between `loadFile` and
`Page.captureScreenshot` were awaited without a deadline, and both cleanups — the hidden window
and the temp folder — sit in `finally` blocks that a never-settling `await` never reaches. So one
stalled frame took the window, the folder and the whole run with it.

It is not hypothetical and it is not rare. Measured on win32 across 100 captures with an 8 s cap on
each, the packaged app failed to answer `Page.captureScreenshot` on **15 of 80** across four
packaged shapes — 19%, and 4 of 20 in the shape that ships — while the dev build answered 20 of 20.
Four suspects died in the same table: not the fonts wait (the per-step probe timed
`document.fonts.ready` at 0–2 ms on every capture, the ones that then hung included), not asar
packing, not the GPU, not a 0.2.0 → 0.3.0 regression. Every capture that did answer answered in
39–1 075 ms.

Every step now has a **30 s deadline** — ~28× the slowest capture ever measured, and the same
number Playwright's adapter already lives under — and a capture that misses it is retried once on a
fresh window. The deadline is per step so that the failure names the command that stopped
answering, because that name is what the export report carries.

**What this does not do, stated plainly: the retry recovered 9 of the 15 hangs, not 15.** Roughly
7% of packaged captures still fail — and that residual belongs to the probe's 8 s deadline, since
no measurement here ever waited the 30 s that ships, so a capture answering somewhere in between is
ruled out by nothing. What changes is that they fail as a reported failed frame, with
the frames that worked written to disk and named in `result.json`, and the run reaching an end.
Why a packaged build hangs where the dev build does not is a Chromium-level question this card
localised and did not answer; it has a follow-up of its own in TYTO-152, and the deadline does not
explain it.

ADR 0030 records the decision and corrects ADR 0027, whose Consequences predicted the wrong failure
mode — an `attach` collision — and said it was not measured. It is measured now, and it was the
other command.
