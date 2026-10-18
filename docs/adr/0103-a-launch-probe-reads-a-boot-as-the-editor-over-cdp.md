# 0103 — A launch probe reads a boot as a window with the editor, reached over CDP

Status: accepted · 2026-10-18 · TYTO-308 · amends ADR 0067 (the measured criterion of its proof, not
its decision)

## Context

ADR 0067 and its two amendments prove three things about the packaged app with launch probes in
`apps/desktop/e2e/packaged.package.test.ts`: that it ignores `ELECTRON_RUN_AS_NODE` (TYTO-193),
that it refuses a modified `app.asar` (TYTO-241), and that it ignores `--inspect` (TYTO-249). Each
needs to tell "booted as the app" apart from "refused to start", and ADR 0067 measured the first
as **still running at a 15 s deadline**, where the process tree was killed. A Node, or an app that
refuses, exits at once.

That criterion cost the whole deadline every time the answer was "booted": 4 probes of 6 in the
suite on Windows and macOS, and 5 of 6 on Linux, where the patched copy also boots. On CI run
39138772025 (`main`, 2026-10-18) the three tests took 15.2 s, 30.3 s and 30.1 s, and
`test:package` was 156 s, the median of 10 runs. It also reads a process stuck before any window
as a boot.

## Decision

**A probe that expects a boot ends when the app has a window whose page has `#editor .cm-content`,
reached over the Chrome DevTools Protocol.** That is `ended: 'booted'`. The probe then kills the
process tree, closes the CDP connection, and waits for `close`, so stdout and stderr are complete
before anything reads them (`printedOne`, `debuggerListening`).

The kill comes before the disconnect because the other order was measured to cost 30 s on Linux:
on CI run 39174295738 all 5 booting probes reached the editor at 585–669 ms and returned from
`browser.close()` at 30,598–30,683 ms. With the process gone, the disconnect is immediate. Each
probe prints `[TYTO-308] probe <ending>: booted at … ms, process closed at … ms`.

- **The signal is the one the CDP harness already waits for.** `waitForBoot` in
  `e2e/boot-signal.ts` reads `DevToolsActivePort` from the launch's own data folder, connects and
  waits for the editor. `launchOverCdp` and both probes (`probeLaunch`, `probeRunAsNode`, through
  `watchLaunch`) use it, so "booted" means the same thing for a probe as for the app the other
  tests drive. No product change: `--remote-debugging-port` is a Chromium switch that no fuse
  gates (ADR 0067, TYTO-249 amendment).
- **`--remote-debugging-port=0` is passed only where the isolating switches are.** A Node exits 9
  on a switch it does not know, so it goes beside `--user-data-dir`, and the RunAsNode control,
  which starts a Node, gets neither.
- **The deadline is an upper bound, not the signal.** It is `FIRST_WINDOW_TIMEOUT_MS` (60 s), so a
  slow runner cannot pass for a refusal. A probe that reaches it ends as `killed`, which is no
  longer a boot: an assertion that wants a boot now reads `booted`, and `killed` fails it.
- `exited` is unchanged: on its own, before either.

The tests that make two probes have a 150 s budget, two deadlines and room for the rest.

## Consequences

- The three tests end when their apps boot. Measured locally on Windows, the same machine before
  and after: TYTO-193 16.1 s → 2.3 s, TYTO-241 21.7 s → 11.4 s (most of what is left is copying
  the release folder), TYTO-249 `--inspect` 32.5 s → 4.3 s. The CI numbers are in the pull
  request.
- A probe still waits the whole deadline for what never boots and never exits. Nothing in the
  suite expects that today.
- ADR 0067's proof sections still say "still running at a 15 s deadline". They are the record of
  what was measured then; this ADR is what the tests assert now.
- `update.package.test.ts` is unchanged: its two AppImage builds are separate by nature, and
  building them in parallel is not part of this card.
