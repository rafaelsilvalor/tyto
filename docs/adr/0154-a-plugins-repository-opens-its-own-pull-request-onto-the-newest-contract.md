# 0154 — A plugin's repository opens its own pull request onto the newest contract

Status: accepted · 2026-10-29 · TYTO-460 · builds on ADR 0149, ADR 0150 and ADR 0152

## Context

ADR 0149 published the contract and `docs/plugin-authoring.md` gave each repository a
`contract` workflow: every Monday at 09:00 it installs `@latest` of the contract over the
locked tree, builds and tests, and changes nothing. A red run warns; a green one says nothing,
and moving the ranges stays a pull request somebody writes by hand.

Measured on 2026-10-29, the day 0.7.0 of `@tyto/plugin-api` had been out for hours:

| Repository             | Asks for                                                                         | Published                                           |
| ---------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| `tyto-template-tabela` | core `^0.30.0`, house-style `^0.2.0`, plugin-api `^0.7.0`, template-kit `^0.4.0` | the same (TYTO-458 moved them by hand that morning) |
| `tyto-plugin-jira`     | plugin-api `^0.5.0`                                                              | 0.7.0                                               |
| `estrategia-workspace` | core `^0.29.0`, recipe `^0.1.0`                                                  | core 0.30.0                                         |

Three copies of the same workflow, each naming its own packages, two of them behind.

Three constraints shape any automation of it:

- A push or a pull request made with a workflow's `GITHUB_TOKEN` starts no other workflow, so
  a pull request the job opens would sit with no checks. `workflow_dispatch` and
  `repository_dispatch` are the exceptions.
- A repository's setting decides whether `GITHUB_TOKEN` may open a pull request at all; all
  three answered `can_approve_pull_request_reviews: false` (the API's name for "Allow GitHub
  Actions to create and approve pull requests").
- `estrategia-workspace` is private. A reusable workflow in a public repository may be called
  from any repository.

## Decision

1. **One reusable workflow, `.github/workflows/contract-update.yml` in Tyto**, which each
   repository calls in about ten lines. It is never run here (`workflow_call` only). The
   contract's publisher keeps the contract's update, and the next template repository is a
   caller from its first commit rather than a fourth copy.
2. **The packages to move are the caller's, read from its `package.json`**: every dependency
   whose spec is an alias onto `PUBLISHED_PREFIX` (ADR 0149), in the section it sits in. Each
   is re-added at `@latest` with pnpm, so the range written (`^<latest>`) and the lockfile are
   pnpm's own. The logic is `tools/repo-checks/src/contract-update.mjs`, which imports only
   Node and `publish-contract.mjs`'s prefix; the workflow fetches those two files and nothing
   else of Tyto, at the `tyto-ref` input, which a caller keeps equal to the ref it pins the
   workflow at.
3. **The manifest's `engine` moves with `@tyto/plugin-api`**, at the operator and precision it
   was written with (`>=0.7` → `>=0.8`, `^0.7.0` → `^0.8.0`), by rewriting the value in place
   so the file stays as its formatter left it. An engine of more than one comparator is left
   alone and the pull request says so. A repository with no `tyto-plugin.json`, or that does
   not ask for `@tyto/plugin-api`, has no engine to move.
4. **The checks run on the moved tree before anything is pushed**, as the caller's own
   scripts (`checks`, default `typecheck build test`, each skipped when missing). Red: the run
   fails, nothing is opened, and the red run is the warning the old workflow gave. Green: the
   commit takes everything the tree changed, the build included, because a repository that
   commits `dist/` checks in CI that it is what `src/` builds to.
5. **The pull request's checks are dispatched by the job**: after pushing, it runs
   `gh workflow run <ci-workflow> --ref tyto/contract-update`. Each caller's CI therefore
   accepts `workflow_dispatch`. No app, no personal token, no secret in any repository.
6. **One bot branch per repository, `tyto/contract-update`, rebuilt from the default branch on
   every run and force-pushed.** The title names the version of every contract package the
   branch asks for, and nothing that varies between runs; an open pull request with the same
   title is left alone and nothing is pushed. One with another title is the previous contract,
   and is updated in place — title, body and branch. When the default branch already asks for
   the newest contract, an open bot pull request is closed. The branch is the bot's: a commit a
   person pushes onto it is replaced by the next contract.
7. **The trigger is the caller's schedule, daily at 09:00 UTC, plus `workflow_dispatch`.**
   Tyto's release does not notify the repositories.

## Consequences

- Each repository needs, once, by its owner: the caller in place of `contract.yml`,
  `workflow_dispatch:` in its CI, and the "Allow GitHub Actions to create and approve pull
  requests" setting on. Without the setting the run is green up to `gh pr create` and red
  there, which names the cause.
- A new contract reaches a repository within a day. A Tyto release several times a day
  updates the same open pull request rather than stacking one per release.
- A check run started by `workflow_dispatch` reports against the branch's head commit, which
  is the pull request's.
- `contract-update.test.mjs` pins the pure parts (which dependencies, which section, the
  engine's rewrite, the title's stability) and the workflow's shape: the inputs callers pass,
  the files it fetches against the script's imports, the dispatch, the duplicate guard.
  Nothing here measures a real run; TYTO-460's pull request records one.
- A caller pinned at `@main` runs whatever Tyto's `main` holds. A tag would be steadier and is
  one line per caller the day this workflow first breaks one of them.

## Rejected

- **A GitHub App or a personal token** to open the pull request, so its CI starts as for a
  person. It is a secret in every repository, which rotates, and an app to own — to buy what
  `workflow_dispatch` gives for one line in each CI.
- **Running the checks in the job and reporting them on the pull request** as a comment or a
  commit status. The job's checks are `typecheck build test`; a repository's CI is more
  (`format:check`, lint, the `dist/` comparison), and a comment is not a check a person or a
  branch rule reads as one.
- **`repository_dispatch` from Tyto's `release.yml`** right after the publish. It needs a token
  that writes to the other repositories — one of them private — stored in Tyto, and a list of
  the repositories that consume the contract kept in the repository that publishes it, which
  each new template would have to edit. A day's latency is cheaper than both. If it stops
  being, the step is one `gh api` call per caller and the secret.
- **Dependabot or Renovate.** Dependabot moves one package per pull request and knows nothing
  of `engine`; four packages released together arrive as four pull requests, each of which
  fails alone. Renovate can group, but is an app installed on each repository, with its own
  configuration, and still does not move `engine`.
- **A fixed list of the four packages.** The Jira plugin asks for one and the workspace for two
  that are not in the list.

## Note, 2026-10-29 — a pull request opened with `GITHUB_TOKEN` does start `ci`

The first constraint under _Context_ is wrong as measured. On `tyto-plugin-jira#3`, opened by
`github-actions[bot]` on `tyto/contract-update`, `pull_request` did start `ci` (run 40897613023,
head `63b72475`). Its first attempt ended `action_required`: GitHub held it for the approval a
first-time contributor's run needs. The second attempt, started by the maintainer, ran and
passed. So the pull request does not sit with no checks; it sits with a check waiting for a
person. The decision stands, because a dispatched run needs no approval.
