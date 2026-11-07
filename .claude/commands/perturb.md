Prove that a test catches the mechanism it guards: break the mechanism on purpose, run the test
and its neighbours, say who caught it, and put the file back byte for byte. Commit nothing.
$ARGUMENTS names the test (a file, or a file and a test name) and the mechanism it guards (the
source file, and the function or line in it).

AGENTS.md › Tests holds the rule this command follows: before claiming a new test closes a gap,
perturb the real mechanism, run it and its neighbours, and report who caught it; the
perturbation must compile; an uncommitted file is backed up with a copy and restored by copy,
never `git checkout`. Done by hand, the restore is the step that goes wrong, so here it is
unconditional and proved. Run from the repository root, in Git Bash or a Linux shell, with
`node_modules` installed and the packages the test reads built (`/fresh-worktree`). The backup,
the cycle and the restore are `tools/repo-checks/src/perturb-cycle.mjs`, which has tests; this
command calls it in one line each time. Paste each command's output verbatim.

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

3. **Back up the file and record its hash.** The backup goes to a folder outside the
   repository: this session's scratchpad directory, `<scratchpad>/perturb` (`<backup folder>`
   below). The script copies the file before anything touches it, whether or not git tracks it,
   and keeps the original's sha256: the restore is proved against it, not against git. It also
   records the package, the test and the options below, so every later call names only the
   folder:

   ```bash
   node tools/repo-checks/src/perturb-cycle.mjs backup --out <backup folder> --file <mechanism file> --package @tyto/<package> --test src/<mechanism>.test.ts
   ```

   `--file` is relative to the repository root, `--test` to the package. It prints the two
   hashes and `backup: hashes equal`, and the gate it will use. It refuses a backup folder
   inside the repository, and a folder whose `original` differs from the file: that backup may
   be the only copy of the original while a perturbation is on disk.

   **`--rebuild`.** A filtered vitest run reads other packages' `dist`, not their source
   (AGENTS.md › Building). Leave it out when the mechanism and every test you run live in the
   same package. When the mechanism lives in a package whose tests run elsewhere, above all
   `packages/core`, add `--rebuild @tyto/core` (the mechanism's package): the cycle builds it
   after perturbing **and again after restoring**, or the neighbours read stale code and a
   perturbation looks caught, or missed, for the wrong reason. Then add
   `--consumers @tyto/<a>,@tyto/<b>`: the cycle runs each consuming package's suite as well.

   **Compiles** means the package's own typecheck prints no `error TS`. A file no `tsconfig.json`
   includes (a plain `.mjs` in `tools/repo-checks`, say) is not typechecked at all: the script
   gates any file that is not TypeScript with `node --check` instead, prints
   `gate: node --check (weaker …)`, and the report says the gate was the weaker one.

4. **Propose perturbations that compile.** Read the mechanism and write one to three small
   edits, each one a way the code could plausibly be wrong that the test claims to notice: a
   comparison flipped or moved by one (`<` for `<=`, `> 59` for `> 60`), a branch dropped, a
   rounding changed (`Math.floor` for `Math.round`), an early return with a value of the right
   type. Say for each one which test should turn red, and why. **The perturbation edits the
   mechanism only, never the test.** An edit that changes a type, an import or a signature is
   not a perturbation: the typecheck would catch it, not the test.

5. **One cycle per perturbation: apply, compile, run, restore.** Apply the edit with the Edit
   tool, then **in the very next tool call** run the cycle, from the repository root:

   ```bash
   node tools/repo-checks/src/perturb-cycle.mjs cycle --out <backup folder>
   ```

   The cycle prints the edit as it stands on disk (one hunk, `-` and `+` lines), so the report
   quotes the edit that ran, not the one intended. It runs the gate, then the rebuild when one
   was recorded, the test file, the package suite and the consumers, each into its own log in
   the backup folder; it prints each exit, each run's `Tests` line, every `FAIL` line with the
   first error line under it, and a verdict. A perturbation that does not compile is discarded
   and reported as such, never run. A file that still equals its backup runs nothing.

   **The restore runs whatever happens:** in a `finally` block, and from the handlers of
   SIGINT and SIGTERM. Only a kill that cannot be handled, such as a tool timeout that kills
   the process tree, skips it. That is why the rule below has no exception. **If anything stops
   you between the edit and the end of the cycle, the next command you run is the restore,
   before anything else.** It restores, proves and rebuilds, and running it twice is harmless:

   ```bash
   node tools/repo-checks/src/perturb-cycle.mjs restore --out <backup folder>
   ```

   **When the cycle does not print `restore: cmp equal` and
   `restore: same hash as before the first edit`, stop.** Say so at the top of the report, in
   bold, with the backup's path (`<backup folder>/original`) and the original's hash, and run
   nothing else: no other perturbation, no test, no git command. The maintainer copies the
   backup back himself.

   The cycle ends with the step 7 table row for this perturbation; keep it for the report.

   Before the next perturbation, require the hash the cycle printed to equal the original's
   from step 3: every cycle starts from the original, never from the last perturbation.

6. **Prove the tree is as it was, then run the test green once more.**

   ```bash
   cmp <backup folder>/original <mechanism file> && echo "cmp equal" && sha256sum <mechanism file> && git status --short -- <mechanism file> <test file>
   ```

   The hash must equal the original's from step 3, and the `git status` output must equal step
   1's. Then the test, green, on the restored file (the cycle already rebuilt when `--rebuild`
   was set):

   ```bash
   pnpm --filter <package> exec vitest run <test file in the package> 2>&1 | tail -8
   ```

7. **Report.** The table first, one row per perturbation:

   | Perturbation | Typecheck | Who caught it | Verdict |
   | ------------ | --------- | ------------- | ------- |
   - **Perturbation**: the edit, as the cycle printed it (file, line, before and after).
   - **Typecheck**: `exit 0`, or the first `error TS` line.
   - **Who caught it**: each failed test as vitest named it (file and test name), and its first
     error line verbatim; say whether it failed in the test file, in the package suite, or
     both. Empty when nothing failed.
   - **Verdict**: **caught**, **gap** (it compiled and nothing failed), **discarded** (it
     did not compile), or **unclear** (a run failed with no failing test named: read its log
     in the backup folder).

   **A gap is reported as a gap, never smoothed.** A perturbation nobody caught means the
   tests do not guard that part of the mechanism; say which behaviour went unguarded, and list
   it under `## Left open` when the run feeds a PR. This command does not write the missing
   test: that is a separate request.

   Then each cycle's output (the edit, the exits, the `FAIL` lines, the `restore:` lines and
   the hash), step 6's `cmp`, hash and `git status` lines, and the final green run's
   tail. End with what the run did not cover: the packages whose tests read this one's code and
   were not run, and a gate weaker than the package typecheck.

Never commit, push, amend, or edit the test from this command, and never end it with the
mechanism's file different from its backup.
