# 0100 — A scoped required check may decide in a job of its own and roll up parallel jobs

Status: accepted · 2026-10-18 · TYTO-307 · amends ADR 0064 (where the scope is decided, and what
the required context runs)

## Context

ADR 0064 made `desktop` a required context that decides its own scope: the first step of the
`desktop` job runs `tools/repo-checks/src/ci-scope.mjs`, and every later step of that job is
gated on its output. That shape assumes the suite runs in one job.

By 18/10 that job was the slowest gate on every pull request. On the 10 latest green runs
(`gh run view --json jobs`, 17–18/10):

| Step                                 | Median | Min | Max |
| ------------------------------------ | ------ | --- | --- |
| job `desktop`                        | 724 s  | 649 | 748 |
| `pnpm build`                         | 36 s   |     |     |
| `test:desktop` (77 files, 3 workers) | 490 s  | 457 | 508 |
| `test:package` (2 files, serial)     | 156 s  | 135 | 160 |

The two suites ran one after the other on one runner. `test:desktop` grew from 143 s (06/10) to
495 s (18/10), about one file per card. TYTO-235 had priced shards across jobs and declined them
(`docs/architecture.md`): at ~145 s of tests, each shard would have paid the ~70 s of setup again
for less than it saved. That arithmetic no longer holds.

Running the suites in parallel jobs means the scope can no longer live in a step: a step gates
only the job it is in.

## Decision

**A scoped required check may run its suite as several jobs. Then the decision moves to a job
named `scope`, every other job needs it and is gated on its output, and the required context is a
roll-up job that runs no test.**

- `scope` checks out two commits deep and runs `ci-scope.mjs <suite>` as its second step, exactly
  as ADR 0064's first step did, and exports `run` as a job output. Its summary carries the
  `skipped: no change under …` text.
- Every job but `scope` and the roll-up `needs: scope` and carries
  `if: needs.scope.outputs.run == 'true'` (plus `!cancelled()` where it should run after a red
  dependency, as `merge` does).
- The roll-up keeps the context's name (`desktop`), so `main`'s protection does not change. It
  `needs` every other job, runs on `always()`, and has one step that fails when `scope` did not
  succeed, when any needed job failed or was cancelled, or when one was skipped although `scope`
  said to run. A skip is green only when the scope said there was nothing to measure.
- `always()` is the load-bearing word. Without it a failed dependency makes the roll-up
  _skipped_, and branch protection reads a skipped required check as passing.
- `desktop-e2e.yml` is the first user: `scope`, `shard` (a `[1, 2]` matrix running
  `test:desktop --shard=i/2 --reporter=blob`), `package` (`test:package`), `merge`
  (`vitest --merge-reports`, so the suite is still one list in one log) and `desktop`.
- `tools/repo-checks/src/github-config.test.ts` pins the shape per check (`SCOPED_CHECKS`'s
  `shape`): `in-job` for `visual`, which stays as ADR 0064 left it, and `scope-job` for `desktop`.
  For the latter it asserts the two deciding steps, that every job but the roll-up needs `scope`
  and gates on it, that the roll-up needs every other job and runs on `always()`, and that its
  failing step's condition names each of the four results above, OR-ed.

**Two shards, not three, and no duration-aware sequencer.** `--shard` splits over a hash of the
path, not by duration; at two shards the two slowest files (`tab-drag.desktop.test.ts`, ~141 s,
and `sticky-scroll.desktop.test.ts`, ~121 s) land in different shards. A third shard pays another
~70 s of setup against a smaller saving; that is a measurement for the day the suite outgrows two.

## Consequences

- **Runner minutes go up, wall time goes down.** Five jobs pay a job start each, and four of them
  pay a checkout and an install; three pay `pnpm build` and Chromium's libraries. The repository is
  public, so the price is not money, and the required context finishes when the slowest of the
  parallel jobs does instead of after the sum of the two suites.
- **The proof lines moved.** `[TYTO-48]` and `[TYTO-189]` print in the `package` job's log;
  `[TYTO-186]` in `package` and in the shard that runs `installed-plugins.desktop.test.ts`.
  Whoever greps a run's log for them greps those jobs, not `desktop`, whose log holds only the
  verdict.
- **A skip costs more than it did**: the `scope` job and the roll-up are two job starts where
  ADR 0064's skip was one. Both are seconds.
- **A green `desktop` on a scoped-out PR now means four skipped jobs and one green `scope`**, and
  the `skipped: …` summary is on `scope`, not on `desktop`.
- Adding a job to `desktop-e2e.yml` means adding it to the roll-up's `needs`; the test fails if
  that is forgotten. Adding a scoped required check that runs in one job still takes ADR 0064's
  in-job shape.
