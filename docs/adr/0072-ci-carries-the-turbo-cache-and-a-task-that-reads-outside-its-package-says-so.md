# 0072 — CI carries the Turborepo cache, and a task that reads outside its package says so

Status: accepted · 2026-10-09 · TYTO-52

## Context

The `check` job in `ci.yml` ran `pnpm turbo typecheck lint test build` from nothing on every
run. It read `TURBO_TOKEN` and `TURBO_TEAM`, the repository sets neither (0 secrets, 0
variables), and with both empty Turborepo skips the remote cache without a word — the log said
`Remote caching disabled`. TYTO-52 was deferred in September at 19 seconds and given a trigger:
revisit when a cold run passes roughly two minutes. On the seven pushes to `main` before this
ADR the turbo step took 108–175 s, every one `Cached: 0 cached, 74 total`.

The card ordered the options: `actions/cache` on Turborepo's folder first, then a self-hosted
remote cache, then Vercel.

**Turning a cache on changes what a green check means.** Until now every green `check` was a
run. With a cache, a task whose hash did not move prints `cache hit, replaying logs` and does
not run, so the check is only as trustworthy as the hash is complete. Turborepo hashes a task
from its own package's files, the hashes of the tasks it depends on (`^build` brings in every
workspace dependency's build), the external dependencies in the lockfile, and whatever
`globalDependencies` names. A test that opens a file by path outside its package is invisible
to that hash. Measured on `origin/main` (93943ea) with `turbo run typecheck lint test build
--dry=json`, appending one byte to each file and comparing the 76 task hashes the dry run lists
for those four tasks (19 packages × 4; the CI log reports 74 tasks, a different count of the
same run):

| Edited file                                                       | Task hashes that changed |
| ----------------------------------------------------------------- | ------------------------ |
| `eslint.config.js`, `tsconfig.base.json`, `.prettierrc.json`      | 0 of 76                  |
| `docs/render-contract.md`, `docs/render-result.schema.json`       | 0 of 76                  |
| `docs/plugin-authoring.md`, `examples/plugins/…/tyto-plugin.json` | 0 of 76                  |
| `packages/templates/templates/promo-curso/template.html`          | 19, not `editor#test`    |

Every one of those is a file a task reads: ESLint finds the root config by walking up, every
package `tsconfig.json` extends a root one, `docs-gen` and `contract-test` compare against the
committed `docs/`, `cli` installs the example pack and checks the authoring guide, and three
`editor` suites import two built-in templates as raw text from a package the editor does not
depend on. With the cache on, each of those edits would have replayed a green measured against
the file before the edit.

## Decision

**`ci.yml`'s `check` job restores and saves `.turbo/cache` with `actions/cache`, and every file a
cached task reads is in that task's hash.** Concretely:

- **Root configs are `globalDependencies`** in `turbo.json`: `eslint.config.js`, `tsconfig*.json`,
  `.prettierrc.json`, both commitlint configs and the root `package.json`. An edit to any of them
  now changes all 76 hashes. `.prettierrc.json` and the commitlint configs are read by no cached
  task today — `format:check` and commitlint run outside Turborepo — and are listed anyway: the
  price is a cold run after an edit that happens a few times a year, and the alternative is a
  rule someone has to remember the day a task starts reading them.
- **A read outside the package is a `$TURBO_ROOT$` input** in that package's own `turbo.json`,
  after `$TURBO_DEFAULT$`: `tools/docs-gen` (the three generated `docs/` files),
  `tools/contract-test` (`docs/render-result.schema.json`), `apps/cli` (`examples/plugins/**`,
  `docs/plugin-authoring.md`), `packages/editor` (the `promo-curso` and `carrossel-lista`
  template folders). A read through a declared `workspace:*` dependency needs nothing; that
  dependency's build is already in the hash.
- **A task that reads the repository as a whole, or asks git, is `cache: false`.**
  `@tyto/repo-checks#test` is the one: 17 of its 18 suites read outside the package — workflows,
  every manifest, the husky shims, `node_modules`, the desktop sources — and three of them run
  git. TYTO-141 had listed three of those reads as inputs; the list replaces them, because a
  list of a whole repository's reads is wrong the day a suite reads one more file, and the suite
  costs seconds.
- **The cache key carries what Turborepo does not hash**: the OS, the runner image, the Node
  version and the lockfile hash, then the commit; it restores by the same prefix without the
  commit. The image is there because Chromium links its libraries and the fonts are the
  image's; the Node version because the CLI's plugin tests exercise the runtime permission
  model, which moves between Node releases. Either one changing starts a cold run instead of
  replaying a result from the old runtime.
- **The saved folder holds the run's entries and nothing else.** Turborepo never prunes its
  cache, and `actions/cache` saves whatever the folder holds, so every restored entry would be
  saved again with the run's additions. Measured on the pull request that added this: one edit
  to `apps/desktop` took the folder from 44M to 86M, because the desktop build carries the
  bundled Node. The turbo run writes a summary (`--summarize`), and the next step deletes every
  file whose hash the summary does not list. The folder is then one state of the repository,
  44M and 219 files, whatever happened before.
- **Only this job.** `desktop-e2e.yml`, `desktop.yml`, `release.yml` and `visual.yml` stay cold:
  what they ship or measure must never be a replayed build. `github-config.test.ts` pins the
  step, its key, its place before the turbo run, the prune right after it, its absence from
  every other workflow, the dead `TURBO_*` variables staying gone and `repo-checks#test`
  staying uncached.

The rule for a new test is in `docs/conventions.md`: **a test that reads a file outside its
package names that file in the package's `turbo.json`, or is `cache: false`.**

## Measured

The `check` job, from the job's own log. "Before" is the seven pushes to `main` ahead of this
ADR; the rest are runs of the pull request that added it (#31). Turborepo counts 74 tasks.

| Run                                          | `Cached` | turbo `Time`    | turbo step | job       | folder restored → saved        |
| -------------------------------------------- | -------- | --------------- | ---------- | --------- | ------------------------------ |
| before, 7 pushes to `main`                   | 0 of 74  | 1m47.8s–2m54.8s | 108–175 s  | 135–213 s | —                              |
| cold: no entry for the key                   | 0 of 74  | 2m49.0s         | 170 s      | 229 s     | none → 44M                     |
| warm, same commit rerun                      | 73 of 74 | 11.2s           | 12 s       | 56 s      | 43 MB → (exact hit, not saved) |
| one edit in `apps/desktop`, before the prune | 69 of 74 | 33.7s           | 34 s       | 74 s      | 43 MB → 86M                    |
| an edit in `tools/repo-checks` and `ci.yml`  | 71 of 74 | 10.5s           | 11 s       | 46 s      | 85 MB → 44M                    |
| one edit in `apps/desktop`, with the prune   | 69 of 74 | 43.5s           | 44 s       | 83 s      | 43 MB → 44M                    |

Restoring 43 MB took 1–2 s and saving it 1–9 s. The one task a warm run always runs is
`repo-checks#test`. 35–59 s of every job is outside Turborepo — checkout with LFS, install,
`format:check`, the changeset check — and no cache here touches it.

**What a warm run saves depends on where the edit lands.** `turbo run … --dry=json` counts the
task hashes one edit moves: an edit in `apps/desktop` moves 4 of 76, in `packages/template-kit`
22 of 76, in `packages/core` 58 of 76 — close to cold, because nearly everything builds on it.
A pull request's first run restores the newest entry `main` saved; a push to `main` restores
the previous push's.

## Alternatives

- **A self-hosted remote cache** (`TURBO_API` pointed at an own server). It would share entries
  between machines as well as between CI runs, but it is a server someone runs, and a token —
  a secret only the maintainer can create. Not researched further: option 1 answers the case
  the card was about, CI to CI, without it.
- **Vercel's hosted cache.** The default Turborepo is built for, and the reason `ci.yml` carried
  `TURBO_TOKEN` and `TURBO_TEAM`. It needs an account and a token, which is the maintainer's
  decision and not a pull request's. The correctness rules above apply to it unchanged: a remote
  cache replays exactly as a local one does.
- **Inputs for `repo-checks#test`.** Rejected above: the list would be the whole repository, and
  three suites read git state no input can describe.

## Consequences

- **A green `check` can be a replay.** Each replayed task logs `cache hit, replaying logs`, and
  the summary line says how many (`Cached: N cached, T total`).
- **A new test that reads outside its package and forgets the input is a replayed green after
  the next edit to that file**, not a red. Nothing catches that automatically; the convention
  and this ADR are the guard, and `repo-checks` — which is never cached — is where a check that
  reads widely belongs.
- **The folder is bounded by the repository, not by time.** After the prune it holds one entry
  per task of the run — 44M today, of which one desktop build is about 42M (what one desktop
  edit added before the prune existed) — and grows only as the
  packages' outputs do. Every saved entry is a new `actions/cache` key (one per commit), so the
  repository's cache storage holds many copies; GitHub evicts entries unused for seven days and
  keeps the repository under its 10 GB limit by evicting the oldest. At 44M that is over two
  hundred entries before eviction starts. The prune step prints the folder's size, so the day a
  restore costs more than the replay saves shows in the log first.
- **The prune needs the summary.** If `.turbo/runs/` is ever missing or `jq` fails, the step
  fails the job rather than saving an empty or unpruned folder in silence.
- `TURBO_TOKEN` and `TURBO_TEAM` are gone from `ci.yml`. Adopting a remote cache later means
  adding them back with a secret, and this ADR's rules still decide what is safe to replay.
