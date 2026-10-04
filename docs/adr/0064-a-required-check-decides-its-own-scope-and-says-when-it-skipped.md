# 0064 — A required check decides its own scope and says when it skipped

Status: accepted · 2026-10-04 · TYTO-138 · supersedes the "not required" note TYTO-111 left in
`docs/git-workflow.md`

## Context

`main` required two status checks, `check` (`ci.yml`) and `lint` (`commitlint.yml`).
`desktop-e2e.yml` and `visual.yml` were not required, because both were path-filtered and a
required context that never reports leaves a pull request pending for good. So a red desktop
e2e — where TYTO-133 put the pixel comparison and TYTO-43 the window-against-CLI folder diff,
the two claims the beta rests on — stopped nothing. Somebody had to look.

TYTO-111 named the way out and declined it: a second, filter-less job that reports green when
the filter did not match. Its objection is recorded in `docs/git-workflow.md` — _a
green-by-construction context is a check whose name lies about what it measured._

The filter also had a blind spot of its own. `desktop-e2e.yml` ran on `apps/desktop/**`, and the
app bundles almost the whole workspace. Measured on the last 40 merged pull requests (#250 to
#292) for TYTO-138:

| Filter                                                                        | PRs that ran it |
| ----------------------------------------------------------------------------- | --------------- |
| `apps/desktop/**` (the old one)                                               | 23 of 40        |
| what the app bundles: its workspace dependency graph, `apps/cli`, root config | 36 of 40        |

Thirteen pull requests changed something the window runs and never ran the window.

Run timings, from the workflows' own runs: desktop e2e 455–487 s (6 of 6), visual 75–98 s
(11 of 11, all green), `ci.yml` 153–208 s.

## Decision

**A required check that measures something only some pull requests change carries no `paths:`
filter. Its job runs on every pull request, its first step reads the pull request's diff and
decides, and a skip writes what it compared against.**

- `tools/repo-checks/src/ci-scope.mjs`, plain Node with no imports beyond `node:`, runs right
  after checkout and before `pnpm install`. It reads `git diff HEAD^1 HEAD` off the merge
  commit `pull_request` checks out (`fetch-depth: 2`) and sets `run=true|false`. Every later
  step carries `if: steps.scope.outputs.run == 'true'`.
- A skip prints, in the log and in the job summary, `skipped: no change under <every path in
scope>`. The context is green, and the summary says the green is a claim about the diff.
  That is the answer to TYTO-111's objection: the name no longer covers a run that measured
  nothing silently.
- **It fails closed.** A diff it cannot read — HEAD is not a two-parent merge commit, `git`
  errors, the event is not `pull_request` — means run. `push` to `main` therefore always runs
  the whole suite, as it did.
- The desktop scope is **computed from the dependency graph** of `@tyto/desktop`
  (`dependencies` and `devDependencies`, transitively), plus `apps/cli`, which three e2e suites
  run without depending on it. The visual scope keeps the list its filter carried. Both add the
  root files every build reads (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
  `turbo.json`, `.npmrc`, `.nvmrc`, `.node-version`, any root `tsconfig*.json`), their own
  workflow, and the script itself.
- `desktop` and `visual` join `check` and `lint` as required contexts.
  `tools/repo-checks/src/github-config.test.ts` pins all four, asserts no filter on their
  `pull_request` trigger, asserts each name belongs to exactly one job a pull request runs, and
  asserts every step after the scope is gated on it.

**Why not the twin job.** It costs about the same runner time — a job start on every pull
request — and buys less: it keeps the hand-written filter, and with it the 13 of 40. And when a
pull request touches both a filtered and an unfiltered path, two jobs report under one context
name; how branch protection reconciles that was not measured, and a design that needs it to go
one way is fragile in a place nobody looks.

## Consequences

- **Cost, in runner minutes.** On the 40-PR sample, 13 pull requests that skipped the desktop
  e2e would now run it: about 13 × 7.8 min ≈ 100 min per 40 pull requests, plus a skip on the
  other 4. The repository is public, so standard GitHub-hosted runners cost no money; the price
  is wall-clock on those pull requests, and `desktop` is now the slowest required check.
- **A skip's own cost** is a job start, a checkout and one Node process. The pull request that
  introduced this cannot skip — its diff is the workflow — so its step timings for those three
  are the measurement, recorded in the pull request; a real skip is first seen on the first
  docs-only pull request after it.
- **The order of operations is the trap.** If `main`'s protection required `desktop` or
  `visual` before this change reached `main`, every open pull request based on the old
  workflow — filtered, never reporting — would pend forever. The workflow change merges first;
  the maintainer adds the contexts to the protection by hand afterwards. Removing them is the
  same page, in reverse, and is the way back.
- **The version PR** (`changeset-release/main`) is opened by the release bot, and its runs
  already wait for approval before `check` and `lint` start. `desktop` and `visual` join that
  same approval and nothing more.
- A future suite that wants to be required takes the same shape: add it to `SUITES` in
  `ci-scope.mjs`, to `REQUIRED_CHECKS` and `SCOPED_CHECKS` in `github-config.test.ts`, and to the
  protection by hand.
