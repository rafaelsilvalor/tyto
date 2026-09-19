# 0033 — The capture window is offscreen, because `Page.captureScreenshot` waits for a frame nobody was drawing

Status: accepted · 2026-09-19 · TYTO-152 · amends the window in ADR 0027 and closes the open cause in ADR 0030

## Context

ADR 0030 contained a hang it could not explain: in the packaged app `Page.captureScreenshot`
sometimes never answered, the dev build never did it, and four suspects were already dead — the
fonts wait, asar packing, the GPU, a version regression. It shipped a 30 s deadline per step and a
retry, said so plainly, and pointed here.

**The first thing this card measured is that the deadline ADR 0030 chose buys nothing, and that is
the number ADR 0030 declared missing.** Its own instrument section says the 19% belongs to an 8 s
probe cap and that a capture answering between 8 s and 30 s is ruled out by nothing. Measured at
the shipped deadline, on a package rebuilt from `main`, 40 captures, 30 s on all five steps:

```
captures                                 40
first attempt hit the 30 s deadline      8 / 40
Page.captureScreenshot latency           60–1095 ms
answered BETWEEN 8 s and 30 s            0 / 40
retries run / recovered / failed again   8 / 7 / 1
FINAL failed frames (after retry)        1 / 40
```

There is no slow tail. A capture answers in about a second or it does not come back, so "the
packaged build is slower" was never a candidate.

**What the hang is.** `Page.captureScreenshot` asks the browser for a frame of the window's
_surface_. `show: false` hides a window; it does not make it offscreen, and nothing in the
packaged app gives Chromium a reason to compose frames for a window nobody can see. The frame
arrives when something else forces a composite — the ~1 s cluster — or never. Offscreen rendering
is a different mechanism: Chromium produces frames into a bitmap continuously, on its own clock,
whether or not there is a screen.

Five window shapes, 20 captures each, round-robin so drift spreads across the arms, packaged
build, 8 s cap (which after the run above classifies the same captures a 30 s cap would, at a
quarter of the wall clock):

```
arm                              hangs   <500 ms   ~1 s   latency
show: false (what shipped)       4 / 20     9        7     60–1104 ms
backgroundThrottling: false      6 / 20     5        9     70–1084 ms
transparent: false               3 / 20    11        6     64–1089 ms
show: true                       0 / 20    20        0     75–133 ms
offscreen: true                  0 / 20    20        0     59–104 ms
```

**The two arms that give Chromium a reason to draw answer every time, and the ~1 s cluster
disappears with the hang** — which is what says the slow captures and the lost ones are one
mechanism and not two. Two more suspects die here: it is not background throttling, and it is not
the window's transparency, which ADR 0027 introduced and this card has now perturbed twice.

**Changing the request instead of the window makes it worse**, 20 captures each on the same
packaged build:

```
arm                                       hangs      note
Page.captureScreenshot as shipped         6 / 20     the control for this run
fromSurface: false                       20 / 20     never answered once
Page.startScreencast, then capture       20 / 20     its own frame arrived in 25–86 ms, every time
webContents.invalidate() before capture   6 / 20     indistinguishable from the control
```

The screencast row is the useful one: the renderer can produce a frame in this exact window in
under 100 ms, on every attempt, and the capture still hangs afterwards. What is missing is not the
renderer's ability to paint — it is the browser surface the capture reads.

**It is not an artefact of the test harness, and it is not the dev build's absence of one.** Every
number published before this card was taken with `TYTO_HEADLESS=1`, which hides the app's own main
window — not the shape a person runs. With the main window visible:

```
shape               hangs    <500 ms   ~1 s   latency
packaged, headless  3 / 20      3       14    66–1084 ms
packaged, visible   5 / 20      8        7    61–1084 ms
dev, headless       0 / 20     19        1    45–1430 ms
dev, visible        0 / 20     19        1    50–576 ms
```

Across every packaged arm measured in this card without the fix: **18 of 80 hung (22.5%)**, against
**0 of 40** in the dev build.

Finally, on a package rebuilt from this change, the two option sets side by side, round-robin:

```
arm      n    hangs   fast(<500ms)  ~1s(>=500ms)  latency
before   20   6/20    4             10            75–1550ms
after    20   0/20    20            0             63–128ms
```

That run also puts the slowest capture ever measured here at **1 550 ms**, so the deadline's margin
is ~19× and not the ~28× ADR 0030 quotes. What that probe measures is Chromium's behaviour under
the two option sets and not the adapter's own code path; that the adapter uses exactly these
options is what the parity suite covers, now that it imports the same constant.

## Decision

**The capture window is created with `webPreferences.offscreen: true`, and its options live in one
exported constant that the pixel-parity suite uses too.**

- `CAPTURE_WINDOW_OPTIONS` in `apps/desktop/src/main/rasterizer.ts`. `defaultWindow` spreads it;
  `e2e/raster.desktop.test.ts` passes it across `app.evaluate` into the window it builds.
- **The constant is shared because the copy was a hole in the gate.** That suite is what proves the
  adapter's bytes match the Playwright references, it built its window from a retyped copy of these
  options, and this card would have changed the production window while every pixel assertion
  stayed green against a window the app no longer creates.
- **The deadline from ADR 0030 stays.** "No hang on this machine, on this platform, in this build"
  is not "no step can stall", and the deadline is what makes the next one legible instead of
  infinite. Its numbers in that ADR are superseded by the ones above; its decision is not.
- ADR 0027 is amended on one point — the window is offscreen again, which its Decision said it did
  not have to be. Its V3 row already measured this exact combination (the debugger capture on an
  offscreen window) returning a full 1080×1920, so nothing it decided about clipping is disturbed.

## What was rejected, and what it would have cost

**`show: true`.** It measures identically to the fix — 0 of 20, 75–133 ms — and it puts a window on
the screen of the person exporting, once per frame, twelve times for a carousel.

**`fromSurface: false`,** which is the one-parameter change that looked like the cheap answer:
20 of 20 hangs. Worse than the bug.

**Forcing a frame with `Page.startScreencast` before each capture.** Also 20 of 20, and it adds a
protocol dance to every capture.

**Waiting until the dev-versus-packaged difference is named.** It is still not named — see below —
and the fix does not depend on it: what is measured is that a window Chromium draws does not hang,
in either build.

## Consequences

**Text comes out with different antialiasing, and the reference was re-recorded rather than the
number explained away.** Offscreen rendering composites in software, so glyph edges differ. Against
`packages/raster`'s Playwright references, this adapter on win32, before → after:

```
shapes.feed   0.0656%  →  0.0219%   tolerance 0.1%, passing both ways
alpha.square  0.0000%  →  0.0000%   identical both ways
text.feed     1.2219%  →  1.0613%   compared for information; never within tolerance (ADR 0028)
```

Both fixtures that are not already identical moved **closer** to the Playwright reference, which is
the only independent opinion available about what the picture should look like. Against this
adapter's own recorded reference — a regression check, not a parity check — `text.feed` came back
**1.0613%**, the diff is glyph-edge pixels with no layout shift, and the win32 reference was
re-recorded with `UPDATE_DESKTOP_RASTER_REFERENCE=1`.

**`text.feed.linux.png` was deleted in this change and has to be seeded from CI.** A glyph
reference can only be recorded on the platform it is for. Left in place it would have failed the
Linux run against a window that no longer exists; deleted, the suite prints `NOT COMPARED`, writes
the new image into the `desktop-raster-diffs` artifact, and that file is what gets committed.

**Why the packaged build differs from the dev build is still not named.** Both run the same
Chromium and the same code; the dev build hung 0 of 40 with the same hidden window that hangs 18 of
80 when packaged. The mechanism is named — a surface nobody composes — but not why packaging
changes how often it is composed. The fix removes the dependency on that answer rather than
supplying it, and a probe comparing the two processes' GPU feature status hung past three minutes
and was killed, so even that much is unmeasured.

**Everything here is win32, one machine, one session, and no hang was ever observed on Linux or in
CI.** A Linux reader should read this as a change of mechanism whose payoff has not been
demonstrated on their platform — the pixel consequences, however, are on every platform, which is
why the references are the part CI checks.
