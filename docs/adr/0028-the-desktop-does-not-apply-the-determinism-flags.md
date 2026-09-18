# 0028 — The desktop does not apply the determinism flags, and its glyph reference is its own

Status: accepted · 2026-09-18 · TYTO-133 · answers the two questions ADR 0027 left open

## Context

ADR 0027 chose the mechanism — a hidden `BrowserWindow` captured through `webContents.debugger` — and closed by naming two things it had not settled: whether the shipped app applies `DETERMINISM_ARGS` at startup, and the per-platform reference PNGs that are E5.4's real acceptance criterion. Writing the adapter (TYTO-133) is what forced both.

**The adapter works, and the number that says so is the one nobody had run.** E5.4 asks for _the same fixtures within the visual tolerance of the Playwright references_. Measured for the first time here, on win32, the adapter against `packages/raster/src/__fixtures__/reference/`, tolerance 0.001 and pixelmatch threshold 0.1:

```
fixture       app with DETERMINISM_ARGS   app as it actually launches
shapes.feed   0.0369%                     0.0656%
alpha.square  0.0000%                     0.0000%
text.feed     0.9556%                     1.2219%
```

Shapes and alpha pass either way. Glyphs miss by roughly twelve times the tolerance either way, and the flags move the number without deciding it.

**The reason glyphs miss is not the adapter, and it is measurable rather than arguable.** The two adapters drive different Chromium builds:

```
[PROBE versions] electron=152.0.7977.78 playwright=153.0.8010.12
```

A font rasterizer changes between Chromium builds; a rectangle does not. That is the same split `raster.visual.test.ts` already found between operating systems — it keys only the glyph fixture on `process.platform` — appearing again one level down, between engine builds on one operating system.

## Decision

**The shipped app does not apply `DETERMINISM_ARGS` at startup.** They stay what they are in `packages/raster`: flags the CLI's Chromium is launched with.

**`shapes.feed` and `alpha.square` carry E5.4's acceptance criterion, compared against Playwright's committed references on every platform.** Neither is keyed on one, so this is not one platform's answer.

**`text.feed` is compared against a reference recorded by this adapter**, in `apps/desktop/e2e/__fixtures__/reference/`, keyed on `process.platform`. It is a regression check and the suite says so in those words. A missing reference for the running platform prints `NOT COMPARED` and writes the render into the run's artifact; it does not fail, because a glyph reference can only be recorded on the platform it is for.

## Why not the alternatives

**Apply the five flags to the whole app.** They buy 0.03 percentage points on shapes — which already pass — and leave glyphs 1000 times outside tolerance, so they buy nothing on the fixture they exist for. What they cost is visible in every window: `--hide-scrollbars` takes the scrollbars off the editor, `--font-render-hinting=none` and `--disable-lcd-text` turn the app's own text unhinted and greyscale on Windows, and `--disable-gpu` takes the compositor off the preview. Five regressions a user sees, for a number that does not change the verdict.

**Apply them per capture instead of per process.** Not available: they are command-line switches read at process start, and the capture happens in the process the user is already running. `Emulation.setEmulatedMedia` reaches `prefers-color-scheme` and `prefers-reduced-motion`, not the font stack. The document itself already fixes what it can — `export-html` embeds its faces, so the _which font_ question never reaches the host.

**Widen the tolerance to 1.3% so the glyph fixture could be called parity.** Rejected, and it is the important one. 1.3% is thirteen times what `raster.visual.test.ts` defends after a measured perturbation table, and at that width `shapes.feed`'s real 0.0656% and a genuine layout regression would report the same verdict. Two fixtures would stop meaning anything so a third could be described as passing.

**Ship the CLI's Chromium so the builds match.** ADR 0027 already rejected this on size — the packaged app is 390 026 472 B unpacked and Playwright's headless shell beside it is another 283 239 610 B — and matching a reference is a weaker reason than the one already rejected.

## Consequences

**E5.4's criterion is met on shapes and declared on glyphs**, and those are two different claims in one suite. `apps/desktop/e2e/raster.desktop.test.ts` prints the fraction for every fixture on every run, so the distinction is in the log rather than only here.

**A glyph reference exists for win32 and not for linux.** `desktop-e2e.yml` now checks out with `lfs: true` — without it every `__fixtures__` PNG arrives as a 130-byte pointer and the comparison would have compared against a pointer — and uploads `apps/desktop/e2e/__diff__/` so the linux file can be taken from a run and committed. Until it is, the linux job prints `NOT COMPARED` for that one fixture and compares the other two.

**A reference recorded by the code under test only proves stability over time.** It catches the adapter changing; it cannot catch the adapter having been wrong on the day it was recorded. What guards that day is the pair of fixtures compared against Playwright, which is why widening the tolerance to absorb the third was the alternative most worth refusing.

**If Electron and Playwright ever converge on one Chromium build, the glyph fixture should go back to Playwright's reference** and this ADR's third decision is the one to reopen. The probe that measured the split is two lines and is quoted above.
