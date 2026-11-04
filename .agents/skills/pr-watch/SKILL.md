---
name: pr-watch
description: Watch a Tyto pull request after a push (head SHA against the local and remote branch and the runs, orphaned commits on a merged branch, every check run on the head, an e2e red against main, the workflows and jobs the PR did not exercise) and report each item with the command and its output. Use when the maintainer asks to watch or check a PR's CI ("acompanha o PR", "pr-watch"). Reports only; never pushes, merges or arms auto-merge.
---

# PR watch

Codex port of `.claude/commands/pr-watch.md`. Keep the two in step: a rule changed in one is
changed in the other in the same PR.

Watch a pull request's head and checks against the rules a push or a merge has broken before,
and report. Fix nothing.
The request names the pull request number; without one, use the current branch's PR
(`gh pr view --json number --jq .number`).

Every rule here is in AGENTS.md › Branches, CI and merging, and each one cost a red CI run, an
orphaned commit or a wrong claim. Run from the repository root, in Git Bash or a Linux shell,
with `N` set to the PR number and `R=rafaelsilvalor/tyto`. Pass `--repo "$R"` to every `gh`.
Paste each command's output verbatim. This command reads; it never pushes, readies, merges or
arms auto-merge.

1. **Read the PR.** Its state, draft flag, head branch and head SHA (`headRefOid`):

   ```bash
   gh pr view "$N" --repo "$R" --json number,state,isDraft,headRefName,headRefOid,mergedAt --jq '[.number, .state, .isDraft, .headRefName, .headRefOid, .mergedAt] | @tsv'
   ```

   Set `B` to `headRefName` and `S` to `headRefOid`. Every step below reads `S`, the PR's
   current head, never the local `HEAD`.

2. **Compare the head with the local branch and the remote branch.** `refs/pull/<N>/head`
   holds the PR's head even after the branch is deleted:

   ```bash
   git fetch -q origin "refs/pull/$N/head" && echo "pull head: $(git rev-parse FETCH_HEAD)"; echo "remote: $(git ls-remote --heads origin "$B")"; echo "local: $(git rev-parse --verify --quiet "refs/heads/$B")"
   ```

   Read the three lines against `S`:
   - **local equals `S`**: in step.
   - **local is behind `S`** (`git merge-base --is-ancestor <local> "$S"` succeeds): somebody
     pushed or pressed "Update branch". Pull before the next push.
   - **local is ahead of `S`**: commits not pushed yet (`git log --oneline "$S..<local>"`).
   - **state MERGED or CLOSED and `remote` empty** (this one wins over the three above): the
     branch is gone. A push from the local branch now prints `* [new branch]` and lands on no
     PR: the commit is orphaned. Never push it; branch from `origin/main` and cherry-pick what
     `git log --oneline "$S..<local>"` lists. When that list is empty there is nothing to rescue; say the local branch can be
     deleted (AGENTS.md: `git branch -D` once the PR is MERGED or CLOSED and its tip is the
     head or an ancestor of it).
   - **no local branch**: say so; only the remote comparison applies.

3. **Compare the head with the runs.** The latest run of each workflow on the branch, with
   the SHA it ran on:

   ```bash
   gh api "repos/$R/actions/runs?branch=$B&per_page=100" --jq '.workflow_runs | group_by(.path)[] | max_by(.created_at) | [.path, .event, (.head_sha | .[0:7]), .status, .conclusion, .created_at] | @tsv'
   ```

   A latest run whose SHA differs from `S` means CI never ran on the head. After "Update
   branch" that is a known GitHub gap: close and reopen the PR to trigger it
   (`gh pr close` then `gh pr reopen`, which the maintainer or the session that owns the PR
   does, not this command). Older runs on older SHAs are history, not a mismatch; list them
   when they explain the state (`--jq` without `max_by`).

4. **Wait for the checks, then read every check run on the head.** Checks can take minutes to
   appear: when step 3 shows no run yet on `S`, re-query after a few minutes before
   concluding a workflow did not start. Wait with one **background** command, never a polling
   loop:

   ```bash
   gh pr checks "$N" --repo "$R" --watch
   ```

   `--watch` exits when the checks that exist **so far** finish, so its green is not the
   answer. Afterwards read the check runs of `S` from the REST API, which is also the source
   when GraphQL errors break `gh pr checks`:

   ```bash
   gh api "repos/$R/commits/$S/check-runs?per_page=100" --jq '.total_count, (.check_runs[] | [.name, .status, .conclusion] | @tsv)'
   ```

   Require that none is `queued` or `in_progress`; if one is, wait again (background) and
   re-read. Report the count and every row, skipped ones included.

5. **An e2e red is compared with main first.** When a `desktop-e2e` check failed, read main's
   history before blaming the diff:

   ```bash
   gh run list --repo "$R" --workflow=desktop-e2e.yml --branch main --limit 10
   ```

   A test red on main too is not this PR's; say which run on main shows it.

6. **Say what the PR does not exercise, from the workflows themselves.** A run is not proof by
   existing. List every workflow that has no run on `S`, with its trigger keys from the
   checkout's `.github/workflows` (on the PR's branch these are the PR's own workflows):

   ```bash
   ran=$(gh api "repos/$R/actions/runs?head_sha=$S&per_page=100" --jq '.workflow_runs[].path'); for f in .github/workflows/*.yml; do echo "$ran" | grep -qx "$f" || awk -v f="$f" '/^on:/ { if ($2 != "") { print f ": " $2; exit } p = 1; next } p && /^[^ #]/ { exit } p && /^  [a-z_]+/ { sub(/^ +/, ""); t = t (t ? "; " : "") $0 } p && /^    (paths|branches|tags|types):/ { v = $0; sub(/^ +/, "", v); sub(/:.*/, "", v); t = t " " v } END { if (t) print f ": " t }' "$f"; done
   ```

   Then the jobs that ran but skipped, by workflow and name:

   ```bash
   for id in $(gh api "repos/$R/actions/runs?head_sha=$S&per_page=100" --jq '.workflow_runs[].id'); do gh api "repos/$R/actions/runs/$id/jobs?per_page=100" --jq '.jobs[] | select(.conclusion == "skipped") | [.workflow_name, .name] | @tsv'; done
   ```

   Translate both into sentences: a `push` on `main` workflow (`release.yml`) runs only after
   the merge; a `push` on tags (`desktop.yml`, `docs-pages.yml`) only on a release tag; a
   `pull_request` with `paths` ran nothing because the PR touched none of them;
   `workflow_call` and `workflow_dispatch` run only when called. When `desktop-e2e` shows
   `package`, `shard` and `merge` skipped, the e2e suite did not run on this PR.

Report one row per step: the command, its output verbatim, and **in step**, **act** (with the
action: pull, cherry-pick onto a fresh branch from `origin/main`, close and reopen, wait) or
**not applicable**. End with the list of workflows and jobs the PR did not exercise. Never
push, ready, merge or arm auto-merge from this command; a fix it points to is a separate
request.
