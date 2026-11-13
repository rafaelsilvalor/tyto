# Executor protocol

The rules an executor follows when a batch coordinator (`/coordinate`, or its Codex port
`$coordinate`) hands it one card. The coordinator's prompt points here, names the card, pastes
its text and adds its own decisions for that card. This file is the part that is the same for
every card. Where the prompt and this file disagree, the prompt is the more specific and wins;
say so in the report.

An executor executes. Scope, PR split, ADR and technical decisions are the coordinator's; product
and taste questions are the maintainer's, through the coordinator. When the card leaves a
question open that the prompt does not settle, stop and report it instead of deciding.

1. **Work only in your own worktree.** First thing, print `pwd` and
   `git rev-parse --show-toplevel`, and quote both in the report. Never touch another worktree
   or the main checkout. Run git commands plainly from the worktree's root.
2. **Read before working.** `AGENTS.md` (Claude Code reads it through `CLAUDE.md`),
   `docs/architecture.md`, `docs/agents.md` when the card touches a repository command or its
   Codex port, and every file the prompt names as a model.
3. **Branch from `origin/main`.**
   `git fetch origin main && git switch -c <feat|fix|chore|docs>/<KEY>-<slug> origin/main`.
   Never stack on another card's branch.
4. **Prepare the worktree before the first commit** with `/fresh-worktree`
   (`.claude/commands/fresh-worktree.md`; `$fresh-worktree` in Codex), narrowed to the packages
   the prompt names. `node_modules` must exist before the first commit, or the pre-commit hook
   installs everything from inside the hook. Never touch `packageManager` in `package.json`.
5. **Do the card as the prompt describes it, and nothing else.** A loose end found on the way
   goes in the report, not in the diff, unless the prompt says to fix it.
6. **Never touch Jira.** The card's text is in the prompt: make no Jira call to read it. Never
   create a card, never move one: report a card that should exist, and the coordinator creates
   it. Never push a tag, never publish anything.
7. **Measure for real where it is safe.** Run what the card adds where it only reads (a
   command, a script, a check) and paste the tail of its output in the PR body as evidence. The
   prompt says what a rehearsal may and may not do; when it says nothing, a rehearsal writes
   nothing outside your worktree. A new test is perturbed before it is claimed to catch
   something (`AGENTS.md` › Tests).
8. **Run the local checks the card needs, and only those:** typecheck, lint and the tests of
   the packages you touched, the desktop e2e files you added or changed, and
   `pnpm exec prettier --check` on only the files you edited (never on a templates folder). The
   draft PR's CI runs the rest, the whole `test:desktop` included, and a red there comes back
   to you. Paste each output verbatim, with its command.
   - Desktop e2e: a fresh build first (`TURBO_FORCE=1 pnpm build`, or the fallback
     `/fresh-worktree` gives when Smart App Control blocks Turborepo), its own
     `--user-data-dir` and `TYTO_HOME`, and `closeApp()`. With no Electron binary in the
     worktree, set `ELECTRON_OVERRIDE_DIST_PATH` to
     `<main checkout>/apps/desktop/node_modules/electron/dist`, where `<main checkout>` is the
     first path `git worktree list` prints. An e2e test asserts only what needs the real window;
     logic is tested in `packages/*` or jsdom, and a file has a 60 s budget on CI (ADR 0105).
     Look at the real window only when the card changes layout.
   - Known local reds that are not defects: `command-bar` and `search` (the real `layout.json`),
     `raster` (LFS pointers), vitest workers that fail to start under load, `queue.test.ts`. CI
     is the gate.
9. **Commit as `AGENTS.md` › Commits and pull requests says:** a Conventional Commit with the
   key, subject of at most 72 characters, one `-m` per paragraph, no paragraph starting
   `Word: `, no trailers. Check `git log -1`. A changeset for every versioned package the diff
   touches. An ADR only with the number the prompt reserved, confirmed free on `origin/main`
   right before pushing; an ADR-level question without a number goes in the report. About
   1,500 changed lines per PR at most: above that, stop and propose a split in the report.
10. **Open a draft PR.** `git push -u origin HEAD`, then
    `gh pr create --draft --repo rafaelsilvalor/tyto` with an English body that ends in a
    literal `## Left open` heading. Compare the PR's `headRefOid` with `HEAD`.
11. **Stop at the draft.** Do not wait for CI, do not mark the PR ready, do not merge, do not
    arm auto-merge. Always pass `--repo rafaelsilvalor/tyto` to `gh`.
12. **Clean up what you made before the report.** Stop every process you started: dev servers,
    app windows, watchers, background commands. Remove what you created outside your worktree:
    test folders, `--user-data-dir` and `TYTO_HOME` folders, scratch files, and the stash entries
    you pushed (find yours by its tag, never pop another's). Remove only what you created: inside
    a repository, a file only after `git status --short <path>` shows `??`. Your worktree and
    your card's branch stay; the coordinator removes them once the PR is merged or closed. When
    the permission system refuses a deletion, do not work around it: put the command in the
    report.
13. **Your final message is the report**, in English, and the coordinator reads nothing else:
    - `pwd` and the worktree's top level, quoted;
    - the PR number and URL, and its head SHA;
    - the files and line counts (`git diff --stat origin/main`);
    - every local check's output, verbatim, with its command;
    - the decisions you took that neither the card nor the prompt dictated;
    - the cards that should exist, with a reason each;
    - a Left open table: what it is, why it matters, its state, and who owns it;
    - what you cleaned up, and what you left on disk (worktree, branch, any folder), with paths.

    Then stop. **Push nothing after the report**, unless the coordinator resumes you with an
    explicit authorisation to push once more; that authorisation covers one push to the same
    branch, before merge, and you report again after it.

## When the batch closes

When the batch closes, the coordinator resumes you to clean up. Repeat step 12 for anything
made since your report, delete the local branches you created whose PR is MERGED or CLOSED
(`gh pr list --state all --head <branch>`), except the one your worktree has checked out, and
report what you removed and what is left, with paths. Push nothing.

## A plan-only executor

When the prompt says **plan only**, change nothing: no branch, no install, no edit. Read the
card's premise in the code, and end with a plan of 3 to 6 lines that names the files, the open
questions with the options for each, and what you would measure. The coordinator decides and
starts a new executor for the implementation.
