Hunt a suspected timing flake in three arms: the test idle, the same test under a declared load,
and the old code under the same load as control. Report a table of what each arm measured, and
no conclusion without the control. Commit nothing.
$ARGUMENTS names the test (a file, or a file and a test name), and optionally the number of runs
per arm (`N`, default 10), the load (`cpu` or `storm`; the default follows the test's kind), the
control (a SHA; default `origin/main`), and this test's failure text when it is not an
`AssertionError`.

AGENTS.md › Tests holds the rules this command follows: hunt a timing flake in two arms, idle
and under load, with the old code under the same load as control; "Timeout waiting for worker"
with no `AssertionError` is machine load, not the diff; never anchor a grep on vitest output
with `^`, since its first line carries an ANSI prefix. Each default below comes from a hunt on
this repository:

- **The load is part of the instrument.** TYTO-154 (2026-09-20): a 32–80 ms race passed 8 of 8
  runs idle, with the defect present, and went red on run 4 beside six busy-loop `node`
  processes. An idle loop alone would have said "does not reproduce".
- **A launch storm beats a CPU burner for desktop e2e.** TYTO-228 (2026-10-04/05): the same
  desktop e2e race went red 1 of 10 under a 12-thread CPU burner and 4 of 10 while 3 extra app
  instances relaunched every 8 s, each with its own `--user-data-dir` and `TYTO_HOME`.
- **The load needs a control too.** TYTO-191 (2026-10-04): 12 concurrent vitest runs did not
  turn the old test red, 12 of 12; the load missed the window that mattered. A load that leaves
  the old code green proves nothing about the new.
- **A run that dies at launch is another defect.** A desktop run that fails at `firstWindow`,
  or in `beforeAll` with "Hook timed out" before any test ran, is TYTO-231's defect: counted
  apart, never for or against the test.
- **Free memory decides whether the machine was measured.** A 2026-11-03 run had 0.4 GB free of
  15.8, and every failure in it was the machine.
- **Other sessions run e2e on this machine.** Kill only your own load processes, found by the
  tag their command lines carry; never every `electron.exe` or `node.exe`.

Run from the repository root of the tree under test, in Git Bash or a Linux shell, with that
tree ready per `/fresh-worktree`. The arms run `tools/repo-checks/src/flake-hunt.mjs`, which
starts the load with Node, lists processes with PowerShell's `Get-CimInstance` on Windows and
`pgrep -af` elsewhere, and kills one PID at a time with `taskkill` or `kill`. Paste each
command's output verbatim. Reproducing the Linux CI machine is out of scope: say so in the
report.

1. **Say what is hunted and where.** The branch, its HEAD, the control's SHA, and the test:

   ```bash
   git fetch origin main && git branch --show-current && echo "HEAD $(git rev-parse HEAD)" && echo "control $(git rev-parse origin/main)"
   ```

   Then decide the four values the arms share, and say each one with its reason:
   - **`N`**, the runs per arm: 10 unless the request says otherwise. All three arms run the
     same `N`.
   - **The load.** `storm` for a desktop e2e file (`*.desktop.test.ts`, run with
     `--config vitest.desktop.config.ts`), `cpu` for a unit or jsdom test. The request may
     override it; say why when it does.
   - **The failure text** (`SIG`). Empty means an `AssertionError` is this test's failure. Set
     it when the flake shows as something else, such as a `waitForSelector` timeout's first
     line, and copy it from a real red log (CI or local), never from memory.
   - **`T`**, a test name for `-t`, when the file holds other tests whose failures would count
     as this one's.

   When the tree under test is the same commit as the control, say so: the control then
   rehearses the mechanics and decides nothing, and the request needs another SHA.

2. **Prepare the control tree.** A separate worktree at the control's SHA, in a folder outside
   this repository with a short path (Windows paths over 260 characters break the install):

   ```bash
   git worktree add --detach <short folder>/flake-control-<card> origin/main
   ```

   Then prepare it per `/fresh-worktree` from inside it: install, parsers, and the build the
   test reads (`--filter=<package>...` for a unit test; the whole repository for desktop e2e,
   whose suites run the CLI). Prepare the tree under test the same way when it is not ready.
   **When the control cannot be built, stop the hunt here**: the report says "no conclusion:
   the control arm could not be built", with the failing command's output.

3. **Settle the arms' arguments.** All logs go to a folder outside the repository: this
   session's scratchpad directory, `<scratchpad>/flake-hunt` (`<hunt folder>` below). Each
   arm is one call of `tools/repo-checks/src/flake-hunt.mjs`, always the copy in the tree
   under test, the control arm included, and the values the arms share are its arguments,
   the same in all three calls:

   - `--package @tyto/<package>` and `--file src/<file>.test.ts`, relative to that package;
   - `--runs <N>`;
   - `--test "<T>"` and `--sig "<SIG>"` when step 1 set them;
   - `--config vitest.desktop.config.ts` for desktop e2e;
   - `--storm-app <tree under test>/apps/desktop` for the storm.

   An arm writes everything under `<hunt folder>/<arm>/`: `arm.json` (its arguments, the
   tree's short SHA and the free memory at its start), `load.json` (the load's tag and every
   PID it recorded), one `run-<i>.log` per run, `exits.txt` and `classes.txt`. It prints the
   `arm` line (tree, SHA, free memory, and the `node`/`electron` processes before the load),
   the `load` line, one `run <i> exit <code>` line per run, its own stop, the processes after
   the load, each run's class and the arm's row of the table.

   **Why a tag.** Every load process carries a unique tag in its command line: the CPU
   burners (one busy-loop `node` per core) as an extra argument, the storm's instances in
   their `--user-data-dir`, which Chromium passes on to every child process. The script
   starts the load with Node's `spawn`, so the PIDs it records are real (in Git Bash, `$!` of
   a backgrounded `node` is a `bash.exe` wrapper, measured while writing this command). The
   tag is what lets `stop`, a separate process, find the load after a timeout killed the
   arm, and reach the storm's child processes, which nobody recorded at launch. Listing and
   killing by the tag reaches exactly this hunt's processes and nobody else's.

   **The storm** launches the built app in `--storm-app`: the tree under test's
   `apps/desktop`, built (`out` present), and the same folder for every arm, so the load is
   identical. Every 8 s it starts 3 instances, each with its own `--user-data-dir` and
   `TYTO_HOME` under the arm's folder, and kills the previous round. When that tree has no
   Electron binary, set `ELECTRON_OVERRIDE_DIST_PATH` as `/fresh-worktree` says;
   `require('electron')` honours it.

   **The classes.** Each run's log is read once, with vitest's colours stripped, in this
   order: `pass` (exit 0, with vitest's `Tests` line, so a run that ran nothing shows),
   `flake` (this test's failure: `--sig`, or an `AssertionError` when there is none),
   `launch` (the app never opened a window, or a hook timed out before any test passed),
   `worker` (vitest could not start a worker: machine load), `other` (a failure none of these
   matched). **Only `flake` counts as the flake.** Read every `other` log yourself: when it is
   this test's failure, classify the arm again with that text as `--sig`. `classify` reads
   the logs without running anything, and keeps the new `--sig` for `compare`:

   ```bash
   node tools/repo-checks/src/flake-hunt.mjs classify <arm> --out <hunt folder> --sig "<SIG>"
   ```

4. **Run the three arms, one at a time.** An arm takes `N` runs of the test, minutes for a
   desktop file: start each one in the background and wait for it to exit, never a polling
   loop. A tool timeout kills the arm without its own stop, which is what the background run
   avoids. Never run two arms at once: each would be the other's load. Add step 3's optional
   arguments to each call:

   ```bash
   node tools/repo-checks/src/flake-hunt.mjs arm idle --load none --cwd . --out <hunt folder> --package @tyto/<package> --file src/<file>.test.ts --runs <N>
   ```

   ```bash
   node tools/repo-checks/src/flake-hunt.mjs arm load --load <cpu|storm> --cwd . --out <hunt folder> --package @tyto/<package> --file src/<file>.test.ts --runs <N>
   ```

   ```bash
   node tools/repo-checks/src/flake-hunt.mjs arm control --load <cpu|storm> --cwd <short folder>/flake-control-<card> --out <hunt folder> --package @tyto/<package> --file src/<file>.test.ts --runs <N>
   ```

   **After every arm, whatever happened to it, run its stop.** It reads the tag from
   `load.json`, kills only the processes whose command line carries it, lists the machine
   again, and prints what is left. It is harmless when the load is already gone, and says so
   for an idle arm:

   ```bash
   node tools/repo-checks/src/flake-hunt.mjs stop <arm> --out <hunt folder>
   ```

   An arm counts only when its stop printed `0 processes left` and `still alive: none` (it
   exits 1 otherwise). When either names a process, kill that PID alone, say so in the
   report, and run the stop again. The `node/electron processes` counts before and after are
   other sessions' work beside the hunt: a count that moved means the machine changed during
   the arm, and the report says so.

5. **Remove the control tree.** From the repository root:

   ```bash
   git worktree remove --force <short folder>/flake-control-<card> && git worktree list
   ```

   When git says the worktree is locked (agent tools create theirs locked), unlock it first
   with `git worktree unlock <path>`. On Windows the remove can leave an empty `node_modules` skeleton
   behind: when `ls <short folder>` still shows `flake-control-<card>` and `git worktree list`
   no longer does, delete that folder.

6. **Compare the failures.** The distinct first lines of each arm's failures, counted, then
   step 7's table and what it says, read again from the logs as `classify` reads them:

   ```bash
   node tools/repo-checks/src/flake-hunt.mjs compare --out <hunt folder> --arms idle,load,control
   ```

   Failures **differ** between two arms when the `flake` lines name different tests or
   different first lines; a different number at the end of the same line (a timeout in ms, a
   pixel count) is the same failure.

7. **Report.** When any arm started with free memory under a tenth of the total, say so first,
   in bold: that arm may have measured the machine. Then the table `compare` printed, one
   row per arm:

   | Arm | Tree | Load | Free memory | Runs | Pass | Flake | Launch | Worker | Other | Failure first lines |
   | --- | ---- | ---- | ----------- | ---- | ---- | ----- | ------ | ------ | ----- | ------------------- |

   **Failure first lines** quotes each distinct line verbatim with its count, and says whether
   it differs from the other arms' (step 6). Then read the table, and say nothing it does not
   show:
   - **The control decides whether the load reproduces the defect.** When the control under
     load has no `flake` run, the report says "no conclusion: the load did not turn the old
     code red" (TYTO-191), as `compare` prints it. Nothing about the tree under test follows
     from its own green runs.
   - **When the control went red k of N under load**, its rate is about k/N, and the chance
     that a tree with the same defect shows 0 of N under the same load is (1 − k/N)^N: 4 of 10
     gives 0.6^10 ≈ 0.6%, 1 of 10 gives 0.9^10 ≈ 35%. Write that number beside a green load
     arm (`compare` prints it for the control); above a few percent, the green arm proves
     nothing, and the next step is a larger `N`.
   - **Idle against load** says whether the failure needs the load: red only under load is a
     timing flake; red idle too is not a timing flake, and this command is the wrong tool.
   - **`launch`, `worker` and `other` runs count for nothing.** When they are more than a
     third of an arm, that arm measured the machine or the launch, and the report says so.

   Then each arm's output as printed (the `arm` line, the `load` lines, the exits, the
   `load stopped` and `still alive` lines, the per-run classes and the row), the stops of step
   4, step 5's output, and step 6's output. End with what the hunt did not cover: the Linux CI
   machine, the load kind not run, and any arm that did not count.

Never commit, push, or edit the test or the code under test from this command, and never end it
with a load process of this hunt still running.
