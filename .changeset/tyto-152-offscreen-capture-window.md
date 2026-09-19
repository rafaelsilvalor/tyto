---
'@tyto/desktop': patch
---

TYTO-152 — the export stops losing frames in the installed app: a capture that used to hang forever
now answers every time, because the window it is taken on is one Chromium actually draws.

TYTO-148 measured the hang and contained it with a deadline; it did not explain it, and said so.
The explanation is that `show: false` hides a window without making it offscreen.
`Page.captureScreenshot` asks for a frame of that window's **surface**, and in the packaged app
nothing composes a surface for a window nobody can see — so the frame turns up about a second late,
or never. The window now uses `webPreferences.offscreen: true`, which is a different mechanism:
Chromium produces frames into a bitmap on its own clock, screen or no screen.

Measured on win32, the packaged app rebuilt from this change, 20 captures per arm, round-robin:

```
arm      hangs   fast(<500ms)  ~1s(>=500ms)  latency
before   6 / 20       4             10       75–1550 ms
after    0 / 20      20              0       63–128 ms
```

The ~1 s cluster disappears with the hang, which is what says they were one mechanism. Across
everything this card measured without the fix, 18 of 80 packaged captures hung (22.5%); with it,
0 of 20 here and 0 of 20 in the arm that first tried it. Four more suspects died on the way: not
background throttling (6 of 20), not the window's transparency (3 of 20), not the test harness
hiding the main window (5 of 20 with it visible — the shape a person runs), and not the request
itself — `fromSurface: false` hung 20 of 20 and forcing a frame with `Page.startScreencast` hung
20 of 20 after its own frame had arrived in under 100 ms every time.

**What changes in the picture, stated rather than discovered later: text is antialiased slightly
differently**, because offscreen rendering composites in software. Against the Playwright
adapter's references, the desktop's output moved _closer_ on both fixtures that were not already
identical — `shapes.feed` 0.0656% → 0.0219% and `text.feed` 1.2219% → 1.0613% — and `alpha.square`
stays byte-identical. The desktop's own `text.feed` reference, which is a regression check, was
re-recorded: the diff is glyph-edge pixels with no layout shift.

**The 30 s deadline from TYTO-148 stays.** No hang on one machine, on one platform, in one build is
not the same as no step ever stalling, and the deadline is what keeps the next one legible.

ADR 0033 records the decision, amends ADR 0027's window and supersedes the measurements in
ADR 0030 — including its residual: at the deadline that actually ships, 8 of 40 captures hung, 0 of
40 answered anywhere between 8 s and 30 s, and the retry left 1 of 40 failing rather than the ~7%
that ADR quotes. **Why a packaged build differs from the dev build at all is still not named**, and
the fix does not depend on the answer.
