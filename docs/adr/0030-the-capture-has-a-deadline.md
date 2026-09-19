# 0030 — A capture has a deadline, and a frame that cannot be captured is a reported failure

Status: accepted · 2026-09-19 · TYTO-148 · amends the Consequences of ADR 0027, whose predicted failure mode is now measured and was the wrong one

## Context

ADR 0027 put the desktop's capture on `webContents.debugger` and described it as a sequence that
resolves once with the bytes. Nothing in that sequence was given a clock. `captureThroughDebugger`
awaited five things — `loadFile`, `document.fonts.ready`, `Page.enable`,
`Emulation.setDeviceMetricsOverride`, `Page.captureScreenshot` — and a search of the file for a
timer returned nothing.

**A `Page.captureScreenshot` that never answers is what a beta tester actually met.** The export
dialog sits at 11 of 12 forever, the run never reaches `finished`, and because both cleanups live
in `finally` blocks that a never-settling `await` never reaches, the hidden `BrowserWindow` and the
temp folder leak with it.

Measured on win32, Electron 44.3.0, one machine, 100 captures, an 8 s probe cap, the packaged
build rebuilt from `HEAD` first:

```
shape                                  timeouts   of which the retry ALSO timed out
dev 0.3.0 (electron .)                  0 / 20     —
packaged 0.3.0 (asar)                   4 / 20     2 of 4
packaged 0.2.0 (asar)                   6 / 20     2 of 6
packaged 0.2.0, asar extracted loose    3 / 20     1 of 3
packaged 0.2.0, --disable-gpu           2 / 20     1 of 2
```

Packaged overall **15 hangs in 80 captures (19%)**; dev **0 in 20**. That probe put a clock on the
last step only. Per step, from the earlier run — a 15 s cap on _each_ step, against the packaged
**0.2.0** build, before the rebuild — which is the only measurement that ever timed the other four:

```
r1a: loadFile=111ms/OK  fontsReady=0ms/OK  Page.enable=0ms/OK  setDeviceMetrics=1ms/OK  captureScreenshot=59ms/OK
r1b: loadFile=105ms/OK  fontsReady=0ms/OK  Page.enable=0ms/OK  setDeviceMetrics=2ms/OK  captureScreenshot=15007ms/TIMEOUT
```

**Four hypotheses died in that table, and one of them was this repository's own.** It is not the
fonts wait — in the per-step run above `document.fonts.ready` settled in 0–2 ms on every capture,
the ones that then timed out included, and in the 100 captures it was awaited with no clock on it
and never once failed to settle; the faces are `data:` URIs `export-html` embedded rather than
files inside `app.asar`. It is not asar packing — extracting the archive loose gave 3 of 20 against 6 of 20 packed. It is not the
GPU — `--disable-gpu` gave 2 of 20. It is not a 0.2.0 → 0.3.0 regression — it reproduces at both.
Every capture that answered answered in **39–1 075 ms**, on both build shapes, so there is no
measured middle ground between _slow_ and _gone_.

## Decision

**Every awaited step of a capture has a deadline, a capture that misses one is retried once on a
fresh window, and a capture that misses twice is a reported failed frame.**

- `CAPTURE_DEADLINE_MS = 30_000`, a module constant in `apps/desktop/src/main/rasterizer.ts`,
  overridable only through `DebuggerRasterizerOptions.captureDeadlineMs`, which is there for the
  tests. It is not a setting and it is not threaded through the composition root: a number nobody
  can reason about does not belong in front of a beta tester.
- **Per step, not per capture.** The error message becomes `E_RENDER_FAILED`'s `{problem}`
  verbatim, and the one fact that report can carry which nothing else in the run knows is _which_
  protocol command stopped answering. A single budget around the whole capture would name the
  capture and lose the step.
- **All five steps, not only the one that hung.** `Page.captureScreenshot` is what hung here, on
  one platform, on one machine. The hole the card names is that nothing in the path has a clock.
- **The retry fires only for a deadline**, recognised by a tagged error class rather than by
  matching on a message. A protocol error or a `TypeError` from the arguments is a real answer, and
  asking twice would produce two of it a little later.
- **The detach in the cleanup path may fail and is swallowed.** Detaching from a target that
  stopped answering is exactly the case this runs in; an unguarded throw there replaced the error
  that says what went wrong _and_ skipped `destroy()`, leaking the window the deadline exists to
  reclaim.

### Why 30 000 ms

~28× the slowest capture ever measured here (1 075 ms), and nothing at all has been seen in the gap
between that and "never". It is also Playwright's own default action timeout, which is the number
the repo's other `Rasterizer` already lives under; two adapters disagreeing about how long patience
lasts would be a difference nobody asked for. **That parity is partial, and what it misses is this
card's own subject:** `page.setContent` and `page.screenshot` carry Playwright's default, while
`page.evaluate(FONTS_READY)` at `packages/raster/src/playwright.ts:195` carries no clock at all, so
on the fonts wait specifically the two adapters still disagree. Closing that is not this card.

**The instrument never reached the number it chose, and that comes before the findings.** No probe
here waited longer than 15 s, and the 100-capture run capped each capture at 8 s. So the 19% and
the retry's 9 of 15 are the residuals of an **8 s** deadline, not of the 30 s one that ships: a
capture that would have answered somewhere between 8 s and 30 s is excluded by nothing measured,
and if any such capture exists the shipped deadline fails fewer frames than the table above says.
What the measurements do settle is the lower bound the number has to clear — every capture that
answered answered under 1.1 s — and 30 s clears it 28× over.

## What was rejected, and what it would have cost

**A deadline with no retry.** It is the card as written, and on its own it does not make the beta
export: 19% of packaged captures never answer, so a twelve-frame carousel would come out with
roughly two frames missing **every run**. Loudly broken beats silently hung, and it is still not
something to hand a tester.

**Retrying on every rejection.** It turns one genuine protocol error into two of it, doubles the
wait on a document that is simply broken, and would have fired on the `attach` collision ADR 0027
worried about. `apps/desktop/src/main/rasterizer.test.ts` fails in two places if somebody tries it.

**Making the deadline a user setting, or an argument from `plugins.ts`.** A collision with four
other open desktop cards for a number a person cannot choose well.

## Consequences

**ADR 0027's Consequences predicted the wrong failure mode, and this is the correction.** That
section reads _"The failure mode moves to the debugger. `webContents.debugger.attach` throws if
something is already attached … That is not measured."_ It is measured now, twice over, and both
halves are wrong: the adapter's own probe found that DevTools and the debugger API are separate
sessions, so the collision is not reachable on a window created and destroyed inside one capture;
and the failure that does happen is the opposite shape — not a throw, which the pipeline already
turns into a failed frame, but `Page.captureScreenshot` never answering at all. ADR 0027 is amended
rather than superseded: its decision, its mechanism and its measurements all stand, and only that
prediction is replaced.

**A hung frame now costs time instead of the run.** Worst case per frame is two deadlines,
60 s, and at `DEFAULT_CONCURRENCY = 2` a twelve-frame job whose document is genuinely dead reports
in about six minutes rather than never. A pathological capture where several steps each crawl could
in principle spend 5 × 30 s per attempt; nothing measured comes near it, and it is written here so
that the next person shortening the deadline knows what they are trading.

**Roughly 7% of packaged captures still fail, and the ADR says so rather than the changeset
implying otherwise.** The retry recovered 9 of the 15 hangs; 6 hung again. Those surface as
`frame-failed` — which `packages/pipeline/src/job.ts` already emits and
`apps/desktop/src/main/export.ts` already counts — with the frames that worked written to disk and
`result.json` naming them (ADR 0025). No diagnostic code changes: `E_RENDER_FAILED` already takes a
free-text `{problem}`.

**This is containment and not a cure, and the cause is still open.** Why a packaged build hangs
where the dev build does not is a Chromium-level question that this card localised and did not
answer, and it has a follow-up card of its own in TYTO-152, which carries the table above and the
four suspects it already rules out. Nothing here explains the hang; it only stops the hang from
being the end of the export.

**Everything above is win32, one machine, one session.** No hang has been observed on Linux or in
CI, whose `xvfb` is the environment ADR 0027 and ADR 0028 keyed their references on, and no
capture's latency was measured there. A reader who cannot reproduce any of this on Linux should
read the deadline as a guard whose case has not been seen on their platform, not as a guard for
nothing.
