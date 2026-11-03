Run this branch's checks with no cache, run the desktop e2e files the change reaches, and
paste what they printed. Fix nothing.

AGENTS.md › Building and › Measuring and reporting hold the rules this command follows:
`pnpm check` can be all cache and stops at the first failure, so the evidence is an uncached
`turbo run` with `--continue`, and output is pasted verbatim, never summarized as "the tests
passed". Run from the repository root, in Git Bash or a Linux shell. `node_modules` must exist,
and in a fresh worktree `pnpm -r --if-present run generate:parser` runs once before the first
build.

1. **Fetch first**, so the e2e selection below compares against a fresh `origin/main`:

   ```bash
   git fetch origin main
   ```

2. **Typecheck, lint and unit tests, uncached.** This takes minutes: start it in the background
   with its output going to a file, wait for it to exit (no polling loop), and **touch nothing
   in the tree while it runs**, or it measures a tree that moved under it.

   ```bash
   TURBO_FORCE=1 pnpm exec turbo run typecheck lint test --continue > "$TMPDIR/evidence-check.log" 2>&1; echo "exit $?" >> "$TMPDIR/evidence-check.log"
   ```

   Any scratch folder outside the tree works in place of `$TMPDIR`. The run is evidence only
   when its summary says nothing came from the cache. Turbo pads the labels with spaces, so read
   both lines with a pattern that tolerates them, and paste both:

   ```bash
   grep -E '^ *(Tasks|Cached|Failed): ' "$TMPDIR/evidence-check.log"
   ```

   It counts as uncached only when `Cached:` reads `0 cached` and its total equals the total on
   `Tasks:`. Anything else is reported as **not evidence**, with the two lines, and the run is
   not described as passing or failing.

   **Failures.** `--continue` runs every task after a failure; the summary's `Failed:` line
   names them. For each failed task, paste the end of its own output from the log (the lines
   prefixed with its `<package>:<task>:` name, from the first `FAIL` or error to the task's
   last line). "Timeout waiting for worker" with no `AssertionError` in that task is machine
   load, not the diff: say so, and rerun that package alone with fewer workers, pasting the
   rerun too:

   ```bash
   pnpm --filter <package> exec vitest run --maxWorkers=2
   ```

   **Machine load.** An uncached run of every task can exhaust the machine, the more so when
   other sessions are running. Measure the free memory right before each run and paste it
   beside its summary (on Windows,
   `powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory"`,
   in kB). Classify a failed task by its error text:
   - `process out of memory`, `Failed to allocate memory`, `memory allocation of … failed`, a
     `node::Realloc` abort (exit 134), or a worker that exited or timed out with no
     `AssertionError`: machine load;
   - `spawn UNKNOWN`: machine load or Smart App Control blocking a fresh binary, cause unknown;
   - anything else, and any `AssertionError`: a failure.

   When load or `spawn UNKNOWN` failed tasks, rerun the packages that failed, still uncached,
   with less parallelism, and paste the rerun's summary lines too:

   ```bash
   TURBO_FORCE=1 pnpm exec turbo run typecheck lint test --continue --concurrency=2 --filter=<package> --filter=<package>
   ```

   The rerun counts as evidence only when every package that failed passes in it. Whatever is
   still red after the rerun is reported as red, with its output, not as load.

   **When `turbo.exe` cannot start** (`spawn UNKNOWN`: Smart App Control blocks it on some
   machines), there is no uncached turbo run to report. Run typecheck, lint and test per
   package without turbo, and report it in its own row as **weaker evidence**: it has no cache
   summary to prove anything, and it is never mixed with an uncached result.

   ```bash
   pnpm -r --workspace-concurrency=2 --no-bail --if-present run typecheck
   ```

   (and the same for `lint` and `test`).

3. **Desktop e2e: ask the selector, do not guess from the diff.**
   `tools/repo-checks/src/e2e-select.mjs` (TYTO-309) decides which e2e files a local change
   reaches, including the paths that reach every file and the shared wiring it leaves to CI.
   Run it and paste its output:

   ```bash
   node tools/repo-checks/src/e2e-select.mjs --local
   ```

   - `full: N of N desktop e2e files`: **do not run it locally.** CI runs the whole
     `test:desktop` on every push; say that the change reaches the whole suite and that CI is
     the gate.
   - `nothing to run`: say so, and name the `ignored locally` line if it printed one.
   - `selected: k of N`: the e2e run the built bundle in `apps/desktop/out`, so build first,
     never with `--filter=@tyto/desktop...` (it skips the CLI some suites run), then run the
     command the selector printed, the same way as step 2: in the background, waiting, touching
     nothing.

     ```bash
     TURBO_FORCE=1 pnpm build
     ```

     A worktree with no Electron binary of its own reuses the main checkout's by setting
     `ELECTRON_OVERRIDE_DIST_PATH` to that checkout's `apps/desktop/node_modules/electron/dist`
     on the selector's command. The suites give every launch its own `--user-data-dir` and
     `TYTO_HOME` (`launch-isolation.test.ts` holds that); a launch of the app made by hand for
     this report needs the same.

   The package suite (`test:package`) runs only when the selector printed it; a freshly
   packaged exe may be blocked on the maintainer's machine, and then it is measured on CI.

4. **Report, failures first.** One row per run: the command, its result (**pass**, **fail**,
   **not evidence**, **weaker evidence** or **not run**) and, for a failure, the tail of its
   output verbatim. Then the passing runs with their summary lines. End with what this command
   did not run:
   - the full `test:desktop`, unless the selector selected every file and it was run;
   - `visual.yml` (`pnpm test:visual`), the changeset check and commitlint, which `/pre-push`
     covers;
   - `release.yml`, which runs on push to main, and `desktop.yml`, which runs on a `desktop-v*`
     tag.

Never edit, commit, amend or push from this command; if asked to fix something afterwards,
that is a separate request.
