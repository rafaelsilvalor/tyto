Check this branch against the rules a push has broken before, and report. Fix nothing.
If $ARGUMENTS names a pull request number, read that PR's body in step 6.

Every rule here is in AGENTS.md › Operational rules, and each one cost a red CI run or a
wrong claim. Where a tool already checks a rule, **run the tool** and paste its output; the
prose below is only for what no tool checks. Run from the repository root, in Git Bash or a
Linux shell. `node_modules` must exist.

1. **Fetch first.** Every comparison below is against a freshly fetched `origin/main`:

   ```bash
   git fetch origin main
   ```

2. **Changesets: run what `ci.yml` runs.** It checks that every versioned package the branch
   changed is named by a changeset the branch added, and that no changeset names an
   unversioned package (`@tyto/docs`, `tools/*`). Its header says the three ways a package
   counts as covered. Never trust `pnpm changeset status` alone.

   ```bash
   node tools/repo-checks/src/changeset-coverage.mjs --base origin/main
   ```

3. **Commit messages: run what `commitlint.yml` runs.** commitlint holds the type, the
   TYTO key, the trailers (`Co-Authored-By`, `Claude-Session`, "Generated with"), a header
   of at most 72, and no body paragraph opening with `Word: ` other than the footers
   `ALLOWED_FOOTER_TOKENS` lists (TYTO-603). A body line over 100 is only a warning there.

   ```bash
   pnpm exec commitlint --from origin/main --to HEAD
   ```

   AGENTS.md also asks for body lines wrapped near 78, which no tool checks. Lines between 79
   and 100 are not a failure; name them only if there are many.

4. **ADR numbers.** An ADR the branch added must not share its number with one on
   `origin/main`. This prints each clash and nothing when every number is free:

   ```bash
   for f in $(git diff --name-only --diff-filter=A origin/main...HEAD -- docs/adr/); do n=$(basename "$f" | cut -c1-4); git ls-tree --name-only origin/main docs/adr/ | grep "/$n-" | sed "s|^|$f clashes with |"; done
   ```

5. **Size.** About 1,500 changed lines per PR at most; above that, propose a split rather
   than push. The count includes `pnpm-lock.yaml`, snapshots and fixtures; say how much of it
   they are when they push it over.

   ```bash
   git diff --shortstat origin/main...HEAD
   ```

6. **The pull request body**, when a PR exists (`gh pr view --json body --jq .body`) or a
   body is drafted. No tool checks these two:
   - loose ends sit under a literal `## Left open` heading, which a sweep greps for;
   - it says which workflows the PR does not exercise, derived from the workflows'
     triggers and skipped jobs as `/pr-watch` step 6 does, never from a fixed list.

7. **New apps and desktop files.** Run the two repo-checks that hold the lists, when the
   branch adds a folder under `apps/` or a file under `apps/desktop/src` or `apps/desktop/e2e`.
   A new `apps/<name>` must enter the lists of `changesets.test.ts`; a new desktop file must
   enter `desktop-e2e-map.json`.

   ```bash
   git diff --name-only --diff-filter=A origin/main...HEAD -- apps/
   ```

   ```bash
   pnpm --filter @tyto/repo-checks exec vitest run src/changesets.test.ts src/desktop-e2e-map.test.mjs
   ```

Report one row per step: the command, its output verbatim (or "no output"), and **pass**,
**fail** or **not applicable**. End with what to fix before pushing, or "nothing found".
Never edit, commit, amend or push from this command; if asked to fix something afterwards,
that is a separate request.
