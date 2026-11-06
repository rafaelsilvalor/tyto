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

Run from the repository root, in Git Bash (the load and the process checks use `tasklist`,
`taskkill` and PowerShell, with `pgrep`/`pkill` and `free` as the Linux fallbacks), with the
tree under test ready per `/fresh-worktree`. Paste each command's output verbatim. Reproducing
the Linux CI machine is out of scope: say so in the report.

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

3. **Write the arm script.** All logs go to a folder outside the repository: this session's
   scratchpad directory (`H` below). Write `$H/arm.sh` with the Write tool, filling in the
   values at its top. A shell keeps no variable between tool calls; the script keeps them in
   one place, and its `EXIT` trap is what stops the load:

   ```bash
   #!/usr/bin/env bash
   # usage: bash arm.sh <arm> <tree> <load: none|cpu|storm> [stop|classify]
   H=<scratchpad>/flake-hunt            # every log, the PIDs and the tag
   P=@tyto/<package>                    # the package the test lives in
   F=src/<file>.test.ts                 # the test file, relative to that package
   T=                                   # a test name for -t; empty runs the whole file
   SIG=                                 # this test's failure text; empty means AssertionError
   CONFIG=                              # vitest.desktop.config.ts for desktop e2e; empty otherwise
   N=10                                 # runs per arm
   STORM_APP=                           # storm only: the built apps/desktop the storm launches
   ARM=$1 TREE=$2 LOAD=$3 MODE=${4:-run}
   D="$H/$ARM"; mkdir -p "$D"

   memory() { powershell -NoProfile -Command '$o=Get-CimInstance Win32_OperatingSystem; "{0:N1} GB free of {1:N1} GB" -f ($o.FreePhysicalMemory/1MB), ($o.TotalVisibleMemorySize/1MB)' 2>/dev/null || free -g | sed -n 2p; }
   others() { if command -v tasklist >/dev/null; then tasklist //NH | grep -ciE '^(node|electron)\.exe'; else pgrep -c 'node|electron'; fi; }
   alive() { if command -v tasklist >/dev/null; then tasklist //FI "PID eq $1" //NH | grep -q " $1 "; else kill -0 "$1" 2>/dev/null; fi; }
   # Every load process carries the tag in its command line; these two list and kill only those.
   listtagged() { if command -v powershell >/dev/null; then powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*$1*' -and \$_.Name -ne 'powershell.exe' } | ForEach-Object { \$_.Name + ' ' + \$_.ProcessId }" | tr -d '\r'; else pgrep -af -- "$1" | awk '{ print $2 " " $1 }'; fi; }
   killtagged() { if command -v powershell >/dev/null; then powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*$1*' -and \$_.Name -ne 'powershell.exe' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }"; else pkill -f -- "$1"; fi; }

   start_load() {
     [ "$LOAD" = none ] && return 0
     TAG="flake-load-$ARM-$(date +%s)"; echo "$TAG" > "$D/load.tag"
     case "$LOAD" in
       cpu) for _ in $(seq "$(nproc)"); do node -e 'for(;;){}' "$TAG" & done; sleep 2
         listtagged "$TAG" > "$D/load.pids"
         echo "load cpu: $(grep -c . "$D/load.pids") processes carry $TAG ($(nproc) cores): $(tr '\n' ',' < "$D/load.pids")" ;;
       storm) ELECTRON=$(cd "$STORM_APP" && node -p "require('electron')")
         ( while :; do
             for k in 1 2 3; do
               mkdir -p "$D/$TAG-$k"
               ( cd "$STORM_APP" && TYTO_HEADLESS=1 TYTO_HOME="$D/$TAG-$k/home" "$ELECTRON" . "--user-data-dir=$D/$TAG-$k/data" > /dev/null 2>&1 & )
             done
             sleep 8; listtagged "$TAG" >> "$D/load.pids"; killtagged "$TAG"
           done ) &
         echo $! > "$D/storm.loop"
         echo "load storm: 3 app instances relaunched every 8 s, data folders $D/$TAG-<k>, loop PID $(cat "$D/storm.loop")" ;;
     esac
   }
   stop_load() {
     [ -n "$STOPPED" ] && return 0; STOPPED=1
     [ -s "$D/load.tag" ] || return 0
     TAG=$(cat "$D/load.tag")
     [ -s "$D/storm.loop" ] && kill "$(cat "$D/storm.loop")" 2>/dev/null
     killtagged "$TAG"; sleep 2
     echo "load stopped: $(listtagged "$TAG" | grep -c .) processes left carrying $TAG"
     echo "recorded load PIDs still alive: $(sort -u "$D/load.pids" | while read -r _ p; do alive "$p" && printf '%s ' "$p"; done)(none if empty)"
   }
   strip() { sed 's/\x1b\[[0-9;]*[A-Za-z]//g' "$1"; }
   classify() {
     : > "$D/classes.txt"
     for i in $(seq "$N"); do
       log="$D/run-$i.log"; code=$(sed -n "s/^run $i exit //p" "$D/exits.txt"); text=$(strip "$log")
       if [ "$code" = 0 ]; then class=pass; line=$(grep -m1 -E 'Tests +[0-9]+' <<< "$text")
       elif [ -n "$SIG" ] && grep -qF -- "$SIG" <<< "$text"; then class=flake; line=$(grep -m1 -F -- "$SIG" <<< "$text")
       elif [ -z "$SIG" ] && grep -q 'AssertionError' <<< "$text"; then class=flake; line=$(grep -m1 'AssertionError' <<< "$text")
       elif grep -qE 'firstWindow|Process failed to launch' <<< "$text" || { grep -q 'Hook timed out' <<< "$text" && ! grep -qE '✓|√' <<< "$text"; }; then
         class=launch; line=$(grep -m1 -E 'firstWindow|Process failed to launch|Hook timed out' <<< "$text")
       elif grep -qE 'Timeout waiting for worker|Failed to start .*worker' <<< "$text"; then
         class=worker; line=$(grep -m1 -E 'Timeout waiting for worker|Failed to start .*worker' <<< "$text")
       else class=other; line=$(grep -m1 -E 'Error|FAIL' <<< "$text"); fi
       echo "run $i: $class | $(sed 's/^ *//' <<< "$line")" | tee -a "$D/classes.txt"
     done
     c() { grep -c ": $1 |" "$D/classes.txt"; }
     echo "| $ARM | $(git -C "$TREE" rev-parse --short HEAD) | $LOAD | $(cat "$D/memory.txt" 2>/dev/null) | $N | $(c pass) | $(c flake) | $(c launch) | $(c worker) | $(c other) |"
   }

   [ "$MODE" = classify ] && { classify; exit 0; }
   trap 'exit 143' INT TERM
   trap stop_load EXIT
   [ "$MODE" = stop ] && exit 0
   rm -f "$D/load.tag" "$D/load.pids" "$D/storm.loop"; memory > "$D/memory.txt"
   echo "arm $ARM | tree $TREE at $(git -C "$TREE" rev-parse --short HEAD) | memory $(cat "$D/memory.txt") | node/electron processes before the load: $(others)"
   start_load; [ "$LOAD" = none ] || sleep 5
   ARGS=(run "$F" --reporter=verbose); [ -n "$CONFIG" ] && ARGS+=(--config "$CONFIG"); [ -n "$T" ] && ARGS+=(-t "$T")
   : > "$D/exits.txt"
   for i in $(seq "$N"); do
     (cd "$TREE" && pnpm --filter "$P" exec vitest "${ARGS[@]}") > "$D/run-$i.log" 2>&1
     echo "run $i exit $?" | tee -a "$D/exits.txt"
   done
   stop_load
   echo "node/electron processes after the load: $(others)"
   classify
   ```

   **Why a tag and not `$!`.** In Git Bash, `$!` of a backgrounded `node` is the PID of a
   `bash.exe` wrapper, not of `node.exe` (measured while writing this command). Every load
   process therefore carries a unique tag in its command line: the burners as an extra
   argument, the storm's instances in their `--user-data-dir`, which Chromium passes on to
   every child process. Listing and killing by that tag reaches exactly this hunt's processes
   and nobody else's.

   **The storm** launches the built app in `STORM_APP`: the tree under test's `apps/desktop`,
   built (`out` present), and the same folder for every arm, so the load is identical. When
   that tree has no Electron binary, set `ELECTRON_OVERRIDE_DIST_PATH` as `/fresh-worktree`
   says; `require('electron')` honours it.

   **The classes.** Each run's log is read once, in this order: `pass` (exit 0, with vitest's
   `Tests` line, so a run that ran nothing shows), `flake` (this test's failure: `SIG`, or an
   `AssertionError` when `SIG` is empty), `launch` (the app never opened a window), `worker`
   (vitest could not start a worker: machine load), `other` (a failure none of these matched).
   **Only `flake` counts as the flake.** Read every `other` log yourself: when it is this
   test's failure, set `SIG` and re-classify: the `classify` mode reads the logs again
   without running anything.

   ```bash
   bash "$H/arm.sh" <arm> <tree> <load> classify
   ```

4. **Run the three arms, one at a time.** An arm takes `N` runs of the test, minutes for a
   desktop file: start each one in the background and wait for it to exit, never a polling
   loop. A tool timeout kills the process tree without running the `EXIT` trap, which is what
   the background run avoids. Never run two arms at once: each would be the other's load.

   ```bash
   bash <scratchpad>/flake-hunt/arm.sh idle "$(git rev-parse --show-toplevel)" none
   ```

   ```bash
   bash <scratchpad>/flake-hunt/arm.sh load "$(git rev-parse --show-toplevel)" <cpu|storm>
   ```

   ```bash
   bash <scratchpad>/flake-hunt/arm.sh control <short folder>/flake-control-<card> <cpu|storm>
   ```

   **After every arm, whatever happened to it, run its stop** (a stop finds the load by its
   tag, and is harmless when the load is already gone):

   ```bash
   bash <scratchpad>/flake-hunt/arm.sh <arm> <tree> <load> stop
   ```

   An arm counts only when its stop printed `0 processes left` and no PID after `still alive:`.
   When either names a process, kill that PID alone, say so in
   the report, and run the stop again. The `node/electron processes` counts before and after
   are other sessions' work beside the hunt: a count that moved means the machine changed
   during the arm, and the report says so.

5. **Remove the control tree.** From the repository root:

   ```bash
   git worktree remove --force <short folder>/flake-control-<card> && git worktree list
   ```

   When git says the worktree is locked (agent tools create theirs locked), unlock it first
   with `git worktree unlock <path>`. On Windows the remove can leave an empty `node_modules` skeleton
   behind: when `ls <short folder>` still shows `flake-control-<card>` and `git worktree list`
   no longer does, delete that folder.

6. **Compare the failures.** The distinct first lines of each arm's failures, counted:

   ```bash
   for a in idle load control; do echo "$a:"; grep -v ': pass |' <scratchpad>/flake-hunt/$a/classes.txt | cut -d'|' -f2- | sort | uniq -c; done
   ```

   Failures **differ** between two arms when the `flake` lines name different tests or
   different first lines; a different number at the end of the same line (a timeout in ms, a
   pixel count) is the same failure.

7. **Report.** When any arm started with free memory under a tenth of the total, say so first,
   in bold: that arm may have measured the machine. Then the table, one row per arm, from the
   rows `classify` printed, with the failures added:

   | Arm | Tree | Load | Free memory | Runs | Pass | Flake | Launch | Worker | Other | Failure first lines |
   | --- | ---- | ---- | ----------- | ---- | ---- | ----- | ------ | ------ | ----- | ------------------- |

   **Failure first lines** quotes each distinct line verbatim with its count, and says whether
   it differs from the other arms' (step 6). Then read the table, and say nothing it does not
   show:
   - **The control decides whether the load reproduces the defect.** When the control under
     load has no `flake` run, the report says "no conclusion: the load did not turn the old
     code red" (TYTO-191). Nothing about the tree under test follows from its own green runs.
   - **When the control went red k of N under load**, its rate is about k/N, and the chance
     that a tree with the same defect shows 0 of N under the same load is (1 − k/N)^N: 4 of 10
     gives 0.6^10 ≈ 0.6%, 1 of 10 gives 0.9^10 ≈ 35%. Write that number beside a green load
     arm; above a few percent, the green arm proves nothing, and the next step is a larger `N`.
   - **Idle against load** says whether the failure needs the load: red only under load is a
     timing flake; red idle too is not a timing flake, and this command is the wrong tool.
   - **`launch`, `worker` and `other` runs count for nothing.** When they are more than a
     third of an arm, that arm measured the machine or the launch, and the report says so.

   Then each arm's output as printed (the `arm` line, the `load` lines, the exits, the
   `load stopped` and `still alive` lines, the per-run classes and the row), the stops of step
   4, step 5's output, and step 6's counts. End with what the hunt did not cover: the Linux CI
   machine, the load kind not run, and any arm that did not count.

Never commit, push, or edit the test or the code under test from this command, and never end it
with a load process of this hunt still running.
