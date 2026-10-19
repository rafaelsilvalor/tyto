# 0104 — The slow pointer suites launch Electron with unlimited frames

Status: accepted · 2026-10-19 · TYTO-291

## Context

The end-to-end suites launch the app with `TYTO_HEADLESS=1`, and under it the main window is
created with `show: false` (ADR 0036). A window that was never shown paints **about one frame a
second**. That was measured inside the page, on Windows and on CI's Linux runner. One
`requestAnimationFrame` took 750–963 ms, while `setTimeout(…, 0)` took 0–60 ms and
`document.visibilityState` was `visible`.

**Frames are the cost, not timers.** Playwright's page mouse waits for the input to be handled,
and the renderer handles pointer input once a frame:

| What the suite does                        | Before (CI run 39246270107)   |
| ------------------------------------------ | ----------------------------- |
| one `mouse.move` step with the button held | 1,006–1,039 ms                |
| one drag of 12 steps (`tab-drag`)          | 12,200 ms                     |
| one `mouse.wheel`                          | 2,030 ms, plus ~1 s to settle |
| `scrollLineToTop` (`sticky-scroll`)        | 7.2–24.5 s                    |

On `main` (CI run 39173670901), `tab-drag` took 141.5 s for 12 tests and `sticky-scroll` took
106.7 s. Those were the two slowest files in `test:desktop`, one in each shard (ADR 0100).
`group-splitter` paid the same ~13 s per drag.

**The switches against timer throttling were already on.** The read-only plan expected
`--disable-background-timer-throttling`, `--disable-renderer-backgrounding` and
`--disable-backgrounding-occluded-windows` to help. Playwright 1.63's Electron loader
(`playwright-core/lib/server/electron/loader.js`) already appends `chromiumSwitches()`, which
holds all three, to every launch. `app.commandLine.hasSwitch` reports them without being passed,
and passing them again left every step at ~1,000 ms.

Each candidate switch was measured on one `tab-drag` test, locally:

| Extra switch                 | `requestAnimationFrame` | One 12-step drag | Test file run |
| ---------------------------- | ----------------------- | ---------------- | ------------- |
| none                         | 938 ms                  | 12,040 ms        | 32.7 s        |
| `--disable-gpu-vsync`        | 16 ms, then 912 ms      | 10,101 ms        | 53.0 s        |
| `--disable-frame-rate-limit` | 0.2 ms                  | 171 ms           | 6.2 s         |

## Decision

**`tab-drag`, `sticky-scroll`, `group-splitter` and `tabs` pass `--disable-frame-rate-limit` in
their own `_electron.launch` `args`.** It is written into the array literal beside
`--user-data-dir`, which `launch-isolation.test.ts` can still read.

- **Per file, not through the shared launch wrapper.** The switch was measured on every suite
  through `not-a-first-launch.setup.ts` (CI run 39247372754). The shards' tests went from
  282.95 s and 230.90 s to 152.11 s and 116.25 s. The pointer files account for all of that gain:
  `tab-drag` went from 151.3 s to 24.4 s, `sticky-scroll` from 130.5 s to 7.5 s and
  `group-splitter` from 33.2 s to 8.8 s. The rest of the suites gained nothing measurable.
- **The shared switch turned a passing test red.** It was
  `keybindings.desktop.test.ts` › _u undoes what insert mode typed_: red in 5 of 5 local runs with
  the switch and green in 2 of 2 without. With frames unlimited, the first Escape pressed right
  after typing does not reach vim. With a 1.5 s pause before it, the Escape does reach vim. At one
  frame a second the typing was slow enough to hide this. Read in code but not executed:
  `@codemirror/autocomplete`'s `closeCompletion` takes Escape while a completion source is still
  pending, with no popup drawn. That is a product question for its own card. Here it is a reason
  to leave the switch out of files that never asked for it.
- **`tabs` joined after its own measurement.** It took 81 s on `main` and 23 of 23 tests passed in
  30.0 s locally with the switch. CI numbers are in the pull request.
- **`sticky-scroll` keeps its `scrollLineToTop` as it is.** The plan would have rewritten it to wheel
  only the delta. With the switch, one call takes 0.1–0.6 s on CI, so the rewrite has nothing left
  to save.

## Consequences

- **The shipped app is unchanged.** The switch is a Chromium command-line switch that only these
  test files pass at launch. Nothing under `apps/desktop/src` reads or sets it, and the packaged
  app's launch is not touched.
- A new suite that drags or wheels pays ~1 s per input until it passes the switch too. The comment
  above each of the four launches says why.
- The two slowest files are no longer `tab-drag` and `sticky-scroll`. ADR 0100 chose two shards
  partly because those two fell into different shards. That reason is now weaker, but the
  decision stands: the shards still split the remaining ~150 s and ~115 s of tests.
