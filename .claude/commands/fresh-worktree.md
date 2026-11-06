Make a fresh worktree ready to commit and build: install, generate the parsers, build, and
delete the package folders a branch switch left behind. Commit nothing.
$ARGUMENTS optionally names the packages the card needs (`@tyto/repo-checks`); without it, the
whole repository is built.

AGENTS.md › Building holds the three rules this command follows, and each was learned from a
failed session: `node_modules` must exist before the first commit, or the pre-commit hook
installs everything from inside the hook; `pnpm -r generate:parser` runs before the first build,
since the generated parsers are gitignored; and package folders holding only `.turbo` or
`node_modules` are deleted, because repo-checks scans the folders on disk. Run from the
worktree's root, in Git Bash or a Linux shell. Time each step (`time`, or `date +%s` before and
after) and keep its last lines for the report. Paste each command's output verbatim.

1. **Say where you are.** The worktree, its branch and the base it was cut from:

   ```bash
   git fetch origin main && pwd && git rev-parse --show-toplevel && git branch --show-current && echo "origin/main $(git rev-parse origin/main)" && echo "HEAD $(git rev-parse HEAD)"
   ```

   Run this command inside a worktree, never in the main checkout of another session's branch.

2. **Install from the lockfile.** Never touch `packageManager` in `package.json` (AGENTS.md):

   ```bash
   pnpm install --frozen-lockfile 2>&1 | tail -15
   ```

   Then require that the install changed neither the lockfile nor the root manifest. **The
   command stops here when this prints anything**: say what changed and wait.

   ```bash
   git status --short pnpm-lock.yaml package.json
   ```

   pnpm may warn that it failed to create the `tyto` bin in `tools/*`: the CLI is not built
   yet, and the warning is expected in a fresh worktree.

   Then read where the hooks path comes from. An install run once from inside a hook rewrote
   it. The expected value is `.husky/_`, which `husky` sets in the `prepare` script; worktrees
   share the main checkout's `.git/config`, so the origin printed is that file:

   ```bash
   git config --show-origin core.hooksPath
   ```

3. **Generate the parsers.** `brief-lang` and `template-lang` generate theirs with
   lezer-generator; the output is gitignored, so a fresh worktree has none:

   ```bash
   pnpm -r --if-present run generate:parser 2>&1 | tail -6
   ```

4. **Build.** Without arguments, everything, uncached:

   ```bash
   TURBO_FORCE=1 pnpm build 2>&1 | tail -6
   ```

   Desktop e2e runs the built bundle and some suites run the CLI, so a desktop card always
   builds everything: never `--filter=@tyto/desktop...`, which skips the CLI (AGENTS.md). For
   other work, the arguments narrow the build to the named packages and their dependencies,
   one `--filter` each:

   ```bash
   TURBO_FORCE=1 pnpm exec turbo run build --filter=@tyto/repo-checks... 2>&1 | tail -6
   ```

   Turborepo's summary lines say the run was real and whole: `Tasks:` must show as many
   successful as total, and `Cached:` must show `0 cached`. The pipe to `tail` hides the exit
   code, so these two lines are the verdict.

   **When Windows blocks Turborepo.** Smart App Control can refuse a freshly installed
   `turbo.exe` (`spawn UNKNOWN`, or a message that the executable was blocked). Then build
   through pnpm alone, and **say in the report that the build fell back**:

   ```bash
   pnpm -r --if-present run generate:parser && pnpm -r --workspace-concurrency=2 run build 2>&1 | tail -8
   ```

   **When the worktree has no Electron binary.** `apps/desktop/node_modules/electron/dist`
   is missing when Electron's download did not run in this worktree. A desktop launch can then
   use the main checkout's binary instead of downloading it again: set
   `ELECTRON_OVERRIDE_DIST_PATH` to `<main checkout>/apps/desktop/node_modules/electron/dist`.
   Check it first:

   ```bash
   ls apps/desktop/node_modules/electron/dist 2>&1 | head -3
   ```

5. **List the stale package folders, then delete them.** A branch switch leaves behind the
   folder of a package that exists only on the other branch, holding only its `node_modules`
   or `.turbo`. **`git status --short` alone cannot find them:** both names are gitignored, so
   a folder holding only them prints nothing at all, never `??`. The proof is two facts: git
   tracks no file under the folder (`git ls-files` prints nothing), and the folder holds no
   entry besides `.turbo` and `node_modules`. List the candidates with both facts first:

   ```bash
   for d in apps/*/ packages/*/ tools/*/; do d=${d%/}; [ -z "$(git ls-files -- "$d" | head -1)" ] || continue; rest=$(ls -A "$d" | grep -vxE '\.turbo|node_modules'); if [ -z "$rest" ]; then echo "stale: $d (tracked files: $(git ls-files -- "$d" | wc -l); holds: $(ls -A "$d" | tr '\n' ' '))"; else echo "untracked, holds more, left alone: $d (holds: $(ls -A "$d" | tr '\n' ' '))"; fi; done
   ```

   Nothing printed means nothing to delete. A `left alone` line is somebody's untracked work,
   or a folder this command does not understand: report it and delete nothing in it. For each
   `stale:` line, show the proof once more, then delete that folder alone:

   ```bash
   d=packages/<name>; git ls-files -- "$d" | wc -l; ls -A "$d"; git status --short --ignored -- "$d"
   ```

   ```bash
   rm -rf "packages/<name>"
   ```

   The first command must print `0`, then only `.turbo` and `node_modules`. The last one shows
   the folder as `!!` (ignored) when they hold files, and prints nothing when they are empty
   (git lists no empty folder), so it explains what git sees and is not the proof. Delete only
   inside this worktree, never in the main checkout or another worktree.

6. **Report.** One block per step, with its command, its duration and its last lines verbatim:
   the branch, `origin/main` and `HEAD` from step 1; the install's tail, the empty
   `git status` of the lockfile and the hooks path; the parsers' tail; the build's tail with the
   `Cached:` line, whether it was the whole repository or which filters, and whether it fell
   back to pnpm; the Electron check; and every stale folder with its proof and its deletion.
   End by saying the tree is ready, or what stopped it.

Never commit, push, or change `package.json` or `pnpm-lock.yaml` from this command.

This command does not cover Linux, where `pnpm install` compiles node-pty and needs gcc and make
(AGENTS.md › Building).
