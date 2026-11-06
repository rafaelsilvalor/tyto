Prove that a test catches the mechanism it guards: break the mechanism on purpose, run the test
and its neighbours, say who caught it, and put the file back byte for byte. Commit nothing.
$ARGUMENTS names the test (a file, or a file and a test name) and the mechanism it guards (the
source file, and the function or line in it).

AGENTS.md › Tests holds the rule this command follows: before claiming a new test closes a gap,
perturb the real mechanism, run it and its neighbours, and report who caught it; the
perturbation must compile; an uncommitted file is backed up with a copy and restored by copy,
never `git checkout`. Done by hand, the restore is the step that goes wrong, so here it is
unconditional and proved. Run from the repository root, in Git Bash or a Linux shell, with
`node_modules` installed and the packages the test reads built (`/fresh-worktree`). Paste each
command's output verbatim.

**Never restore with `git checkout`, `git restore` or `git stash`**, not even for a committed
file: the file may carry edits nobody committed yet, and those commands throw them away. The
backup is the only source of the restore.

1. **Say where you are and what the file holds.** The branch, and whether the mechanism's file
   or the test carries uncommitted edits (` M`), is untracked (`??`) or is clean (nothing
   printed):

   ```bash
   git branch --show-current && git status --short -- <mechanism file> <test file>
   ```

   Keep that `git status` output: step 6 compares against it, not against an empty tree.

2. **Run the test green first.** A perturbation is judged by what turns red, so the starting
   point must be green. When it is not, **stop here** and report the red: there is nothing to
   prove against. Paths after `exec` are relative to the package:

   ```bash
   pnpm --filter <package> exec vitest run <test file in the package> 2>&1 | tail -8
   ```

3. **Back up the file, record its hash, and write the cycle.** All of it goes to a folder
   outside the repository: this session's scratchpad directory (`B` below). Copy the file before
   touching it, whether or not git tracks it, and keep the original's hash: the restore is
   proved against it, not against git.

   ```bash
   B=<scratchpad>/perturb; mkdir -p "$B" && cp -p <mechanism file> "$B/original" && sha256sum <mechanism file> "$B/original"
   ```

   The two hashes must be equal. Then write `$B/cycle.sh` with the Write tool, filling in the
   five values at its top. A shell keeps no variable between tool calls; the script keeps them
   in one place, and its `EXIT` trap is what makes the restore unconditional:

   ```bash
   #!/usr/bin/env bash
   M=packages/<package>/src/<mechanism>.ts   # the file the perturbation edits, from the repo root
   P=@tyto/<package>                         # the package the test lives in
   F=src/<mechanism>.test.ts                 # the test, relative to that package
   B=<scratchpad>/perturb                    # the backup folder of step 3
   REBUILD=                                  # see below; empty when nothing reads a dist
   restore() {
     cp -p "$B/original" "$M"
     if cmp "$B/original" "$M"; then echo "restore: cmp equal"; else echo "RESTORE FAILED: $M differs from $B/original"; fi
     sha256sum "$M"
     if [ -n "$REBUILD" ]; then pnpm --filter "$REBUILD" build > "$B/rebuild.log" 2>&1; echo "rebuilt $REBUILD after the restore, exit $?"; fi
   }
   trap 'exit 143' INT TERM
   trap restore EXIT
   [ "$1" = restore ] && exit 0
   diff "$B/original" "$M"
   pnpm --filter "$P" typecheck > "$B/typecheck.log" 2>&1; echo "typecheck exit $?"
   if grep -q 'error TS' "$B/typecheck.log"; then grep -m 3 'error TS' "$B/typecheck.log"; echo "does not compile: discarded, not run"; exit 0; fi
   if [ -n "$REBUILD" ]; then pnpm --filter "$REBUILD" build > "$B/rebuild.log" 2>&1; echo "rebuilt $REBUILD with the perturbation, exit $?"; fi
   pnpm --filter "$P" exec vitest run "$F" > "$B/test.log" 2>&1; echo "test file exit $?"
   pnpm --filter "$P" exec vitest run > "$B/suite.log" 2>&1; echo "package suite exit $?"
   (cd "$B" && grep -E 'Tests +[0-9]+ (failed|passed)' test.log suite.log)
   (cd "$B" && grep -E ' FAIL |AssertionError|Error:' test.log suite.log | head -40)
   ```

   `bash "$B/cycle.sh" restore` runs only the restore. Bash runs the `EXIT` trap when the
   script ends, fails, or is stopped with SIGTERM or Ctrl-C (the `INT TERM` trap turns both into
   a plain exit); only a kill that cannot be trapped, such as a tool timeout that kills the
   process tree, skips it. That is why the rule below has no exception.

   **`REBUILD`.** A filtered vitest run reads other packages' `dist`, not their source
   (AGENTS.md › Building). Leave it empty when the mechanism and every test you run live in the
   same package. When the mechanism lives in a package whose tests run elsewhere, above all
   `packages/core`, set `REBUILD=@tyto/core` (the mechanism's package): the cycle builds it after
   perturbing **and again after restoring**, or the neighbours read stale code and a
   perturbation looks caught, or missed, for the wrong reason. Then add a run of the neighbours
   in each consuming package (`pnpm --filter <consumer> exec vitest run`) to the script.

   **Compiles** means the package's own typecheck prints no `error TS`. A file the package's
   `tsconfig.json` does not include (a plain `.mjs` in `tools/repo-checks`, say) is not
   typechecked at all: replace the typecheck line with `node --check "$M"`, and say in the
   report that the gate was the weaker one.

4. **Propose perturbations that compile.** Read the mechanism and write one to three small
   edits, each one a way the code could plausibly be wrong that the test claims to notice: a
   comparison flipped or moved by one (`<` for `<=`, `> 59` for `> 60`), a branch dropped, a
   rounding changed (`Math.floor` for `Math.round`), an early return with a value of the right
   type. Say for each one which test should turn red, and why. **The perturbation edits the
   mechanism only, never the test.** An edit that changes a type, an import or a signature is
   not a perturbation: the typecheck would catch it, not the test.

5. **One cycle per perturbation: apply, compile, run, restore.** Apply the edit with the Edit
   tool, then **in the very next tool call** run the cycle, from the repository root (`M` is
   relative to it):

   ```bash
   bash <scratchpad>/perturb/cycle.sh
   ```

   **If anything stops you between the edit and the end of the cycle, the next command you run
   is `bash <scratchpad>/perturb/cycle.sh restore`, before anything else.**

   The cycle prints the perturbation as it stands on disk (`diff`), so the report quotes the
   edit that ran, not the one intended. A perturbation that does not compile is discarded and
   reported as such, never run. The last `grep` reads the `FAIL` lines, which name the file and
   the test, and the first error line under each; paste them as printed. Never anchor a grep on
   vitest output with `^`: its first line carries an ANSI prefix (AGENTS.md › Tests).

   **When the cycle does not print `restore: cmp equal`, stop.** Say so at the top of the
   report, in bold, with the backup's path (`$B/original`) and the original's hash, and run
   nothing else: no other perturbation, no test, no git command. The maintainer copies the
   backup back himself.

   Before the next perturbation, require the hash the cycle printed to equal the original's
   from step 3: every cycle starts from the original, never from the last perturbation.

6. **Prove the tree is as it was, then run the test green once more.**

   ```bash
   cmp <scratchpad>/perturb/original <mechanism file> && echo "cmp equal" && sha256sum <mechanism file> && git status --short -- <mechanism file> <test file>
   ```

   The hash must equal the original's from step 3, and the `git status` output must equal step
   1's. Then the test, green, on the restored file (the cycle already rebuilt when `REBUILD`
   was set):

   ```bash
   pnpm --filter <package> exec vitest run <test file in the package> 2>&1 | tail -8
   ```

7. **Report.** The table first, one row per perturbation:

   | Perturbation | Typecheck | Who caught it | Verdict |
   | ------------ | --------- | ------------- | ------- |
   - **Perturbation**: the edit, from the `diff` (file, line, before and after).
   - **Typecheck**: `exit 0`, or the first `error TS` line.
   - **Who caught it**: each failed test as vitest named it (file and test name), and its first
     error line verbatim; say whether it failed in the test file, in the package suite, or
     both. Empty when nothing failed.
   - **Verdict**: **caught**, **gap** (it compiled and nothing failed), or **discarded** (it
     did not compile).

   **A gap is reported as a gap, never smoothed.** A perturbation nobody caught means the
   tests do not guard that part of the mechanism; say which behaviour went unguarded, and list
   it under `## Left open` when the run feeds a PR. This command does not write the missing
   test: that is a separate request.

   Then each cycle's output (the `diff`, the exits, the `FAIL` lines and the `restore:` and
   `sha256sum` lines), step 6's `cmp`, hash and `git status` lines, and the final green run's
   tail. End with what the run did not cover: the packages whose tests read this one's code and
   were not run, and a gate weaker than the package typecheck.

Never commit, push, amend, or edit the test from this command, and never end it with the
mechanism's file different from its backup.
