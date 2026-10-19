# 0106 — The e2e harness ends only the apps its run launched

Status: accepted · 2026-10-19 · TYTO-292

## Context

A desktop e2e suite launches Electron in `beforeAll` and closes it in `afterAll`. Both run in the
vitest worker. When the worker dies — `Worker exited unexpectedly with exit code 3221226505`
(`0xC0000409`), seen on a maintainer's machine under load — nothing runs `afterAll`, and the app
it launched keeps running, hidden, for hours. Three times in the desktop-polish batch
(2026-10-12/13), and on 2026-10-14 ten `electron.exe` processes from three agent worktrees,
ended by hand with `Stop-Process`.

The machine those runs share also runs Rafael's own Tyto and, often, other worktrees' e2e runs.
Ending "every Electron" would end those too, so the only acceptable guard is one that can prove
a process is its own.

## Decision

**Every launch is written down, and the run's teardown ends what is still running.**

- `e2e/launch-ledger.global-setup.ts` runs in the main vitest process of `test:desktop`,
  `test:package` and `shots`. It makes `<tmp>/tyto-e2e-run-*`, writes `owner.json` (its own PID
  and start time) and provides the folder to the workers as `launchLedger`.
- Every launch the harness makes appends one JSON line to that folder with `appendFileSync`, the
  moment the PID is known: `_electron.launch` through the wrapper in
  `e2e/not-a-first-launch.setup.ts`, after the launch resolves, and the three `spawn`s in
  `cdp-app.ts` (`launchOverCdp`), `run-as-node-probe.ts` (`probeRunAsNode`) and `launch-probe.ts`
  (`probeLaunch`), right after `spawn`. The line holds the PID, the `--user-data-dir` (none for a
  Node-mode probe) and the window of time in which the process was created. `recordLaunch` throws
  when no ledger was provided, so a config that forgets the global setup fails on its first
  launch instead of losing the guard silently.
- The teardown — which vitest runs in the main process when a worker crashes too — reads the
  ledger and ends **only the live processes the record proves are its own**:
  - an **app** is found by its folder: a live process whose command line carries
    `--user-data-dir=<the recorded scratch folder>` (the whole value, quotes ignored) and was
    created no earlier than two seconds before that launch began. One query finds the candidates:
    `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%--user-data-dir=%'"` on Windows,
    `/proc/*/cmdline` on Linux.
  - a **Node-mode probe** has no folder, so it is found by its PID, believed only while the live
    process was created inside the recorded window (two seconds of slack either side). One
    `Get-CimInstance … -Filter ProcessId=…` per such PID still alive; `ps -o etimes` on Linux.

  A match is ended with the harness's `killTree` and polled for up to ten seconds; a
  `[TYTO-292]` line says how many were ended, printed only when there were any. Then the folder
  is removed.

- **At setup, abandoned runs are swept by the same rules.** A `tyto-e2e-run-*` folder whose owner
  PID is gone, or now belongs to a process created at another time, is a run that never reached
  its teardown; its recorded launches are ended and the folder removed. A folder whose owner is
  alive belongs to a run in progress, in this worktree or another, and is not touched.

`e2e/orphan-guard.desktop.test.ts` is the measurement: a nested vitest run
(`e2e/__fixtures__/orphan-run`) launches the app through the wrapper and kills its own worker;
the outer test asserts the nested run failed with `Worker exited unexpectedly`, the orphan's PID
is gone and no process carries its data folder, and an app the outer test launched on its own is
still alive.

**Why the data folder and not the PID: measured.** The first version matched apps by PID, as
planned, and the test went red on Windows: the recorded PID was dead and four `electron.exe` were
alive. Playwright 1.63 starts Electron on Windows through a shell (`shell: true`, so
`app.process().pid` is `cmd.exe`), and the shell went with the worker while Electron stayed. A
folder `mkdtemp` made for one launch is carried by every process of that app, main and children.

**Why the data folder and not the executable.** Every e2e launch has had a scratch
`--user-data-dir` of its own since TYTO-139, and `launch-isolation.test.ts` holds that, so the
folder names exactly one run's app. The executable is shared by every worktree that symlinks the
same store, and Rafael's installed Tyto is an Electron too.

**Why the harness and not the app.** A parent-death watchdog inside the app would be test code in
the shipped binary. The seam stays test-side, like the second-launch seed beside it.

## Consequences

- A worker crash no longer leaves an app behind; the crash itself is not addressed, and its cause
  (`0xC0000409` under load) is not measured here.
- **Not covered: the main vitest process dying.** Ctrl+C, a closed terminal or a killed `pnpm`
  never reach the teardown. The next run's sweep ends those apps, so the cost is bounded by "until
  the next run on this machine", not by hours.
- **Not covered: the window between `spawn` and Playwright resolving.** `_electron.launch` gives
  the PID only when it resolves; a worker that dies while it is still launching leaves an app
  that was never written down. The three `spawn` paths record before anything awaits.
- **Not covered: synchronous CLI children** (`execFileSync`/`spawnSync`, `electron-builder`, the
  bundled `node --version`). They are not recorded: each runs to an end of its own and exits,
  where an app waits for input forever.
- A folder whose owner could not be read but is alive is treated as in use: a leftover folder
  costs disk, and ending a live run's apps is the bug this ADR exists to prevent.
