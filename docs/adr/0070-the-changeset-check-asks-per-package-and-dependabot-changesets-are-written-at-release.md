# 0070 — The changeset check asks per package, and Dependabot's changesets are written at release

Status: accepted · 2026-10-09 · TYTO-155 · narrows the `changeset status` step of TYTO-134

## Context

`ci.yml` ran `pnpm exec changeset status` on every pull request, and everybody read it as
"every package this change touched is accounted for". It is not what the command checks.
`changeset status` fails only when packages changed **and `.changeset/` holds no changeset at
all**; it never asks whether the changed packages are the ones the pending files name.
Measured on 2026-09-20, on one Dependabot branch editing thirteen `package.json` files with no
changeset of its own:

```
# .changeset holds two changesets other cards left pending
$ pnpm changeset status
Packages to be bumped:
- patch
  - @tyto/desktop
exit=0

# same branch, .changeset emptied
$ rm .changeset/*.md && pnpm changeset status
If this change doesn't need a release, run changeset add --empty.
🦋 Exited with code 1
```

Two failures follow from that one gap, in opposite directions:

- **A human pull request that changes `packages/core` and writes no changeset passes**, as long
  as some other card's changeset is pending. The protection the step is named for is not there.
- **A Dependabot pull request goes red whenever the folder is empty**, which is exactly the
  state right after every version PR merge. Dependabot cannot write a changeset, so the red is
  about the date, not the bump. Both open Dependabot PRs (#2 and #20) were red on `check` with
  that message on 2026-10-09.

Changesets has no setting for "ignore dependency-only edits": the status command compares
changed packages with changesets and never reads what changed.

## Decision

**1. The check asks per package, and counts only changesets the branch added.**
`tools/repo-checks/src/changeset-coverage.mjs` replaces the bare step. It takes every versioned
package (a manifest with a `version`, under `packages/` or `apps/`) whose files changed between
the merge base with `main` and the head, and fails unless each one is covered:

- named in a `.changeset/*.md` this branch **added** — a pending file from another card
  describes another change and no longer counts;
- or the branch added an empty changeset (`pnpm changeset add --empty`), the explicit "nothing
  here ships";
- or the package's diff is its `package.json` alone, touching only `devDependencies` — a tool
  bump ships nothing. `electron` in `@tyto/desktop` is the exception: it is a devDependency
  because electron-builder demands it, and it is the runtime the installer carries;
- or the pull request was opened by `dependabot[bot]` and the package's diff is its
  `package.json` alone, touching only dependency fields (the lockfile is not a package).

When `.changeset/` holds any file, the script then runs `changeset status` too, because that is
still the only place the tool itself validates what `release.yml` will version (the mixed
ignored/not-ignored refusal that took `release` down twice, TYTO-109). With the folder empty
there is nothing to validate, and running it is the red this ADR removes. The skip on the
version PR's branch (TYTO-134) stays as it was.

**2. Dependabot's changeset is written at release time, not on its pull request.**
`tools/repo-checks/src/dependabot-changesets.mjs` runs in `release.yml` before
`changesets/action`. It walks `main`'s first-parent history back to the last version-packages
commit — subject `chore(release): TYTO-0 version packages (#N)` — and, for every
`dependabot[bot]` commit since, writes one uncommitted `.changeset/dependabot-<sha>-<dir>.md`
per versioned package whose shipped dependencies moved: a `patch`, with one line per
dependency, `` `name` old → new ``. The action versions those files into the version PR like
any other; they are never committed, so each run regenerates them until the version PR is
merged and the range is empty. A Dependabot commit that already added a changeset by hand gets
none, so the bump is not announced twice.

**When no version-packages commit is found, the step fails** instead of reading all of history
and re-announcing every bump ever released. The title it looks for is pinned to `release.yml`'s
`pr-title` and `commit-message` in `dependabot-changesets.test.mjs`, so renaming one without
the other fails before a merge.

## Alternatives

- **Commit the changeset onto the Dependabot pull request from a workflow.** Rejected on three
  measured or documented facts. A push made with `GITHUB_TOKEN` starts no workflow run, so the
  pull request's required checks would never report on the commit that fixed them. The other
  ways to push — a PAT or a GitHub App key — need a secret, and this repository has none
  (`gh secret list` returns nothing for Actions and for Dependabot); adding one is a decision for
  the maintainer, not a side effect of a CI fix. And Dependabot stops rebasing a branch that
  anybody else pushed to, so every such PR would need a human to rebase it from then on.
- **Skip the step for `dependabot[bot]`.** One `if:`, and it gives up the changelog line for
  dependencies that reach the installed app (`zod`, `yaml`, the CodeMirror packages, Electron).
- **Keep `changeset status` and accept the gap.** The human case is the reason not to: the
  check would keep passing exactly the pull request it is named for.

## Consequences

- A human pull request touching a versioned package needs a changeset of its own, even when
  others are pending. A test- or comment-only change takes `pnpm changeset add --empty`, as
  `docs/git-workflow.md` already asked.
- A Dependabot pull request goes green without a human commit, whatever the state of
  `.changeset/`; its bump appears in the next version PR as a patch with the dependency named.
  Both are only visible after this merges: `@dependabot rebase` on #2 and #20, then the next
  version PR.
- The version PR may now open for Dependabot bumps alone, since the generated files are
  changesets like any other.
- `release.yml` checks out the full history (`fetch-depth: 0`) for the walk.
- Whoever pushes onto a Dependabot branch keeps the Dependabot rule for that pull request,
  because the rule reads who opened it. A hand-written changeset pushed there is honoured by
  the generator, which then writes none for that commit.
