# Git and GitHub

## Model: trunk-based with short-lived branches

- `main` is always releasable. Protected: PR required, green CI, 1 approval, linear history (squash merge), no direct pushes.
- One branch per card, lifetime < 3 days: `feat/TYTO-123-slug`, `fix/…`, `chore/…`, `docs/…`.
- No `develop`, no release branches. Versions come from `main` via Changesets.

## Commits

Conventional Commits with the Jira key: `feat(export-svg): TYTO-042 support <mask>`. Scope = package name. Validated by commitlint in the hook and in CI: the `subject-jira-key` rule requires the key followed by a lowercase description. It replaces `subject-case` from config-conventional, which reads the leading key as upper-case and would reject every subject in this format. Squash merge uses the PR title as the message — PR titles follow the same format.

## Pull requests

Template in `.github/pull_request_template.md`: card, what changed, how to test, docs/ADR touched. Rules:

- One card per PR. If the card grew, split the card, not the PR.
- Claude Code opens the PR as a draft and moves the card to Review; the human reviews, marks ready, merges.
- CI runs on every PR; `test:visual` only when `packages/export-*`, `raster`, `templates`, `core`, `fonts/` or `tools/test-fonts` change.
- Optional PR bot (Claude Code Action) reviews against `CLAUDE.md`.

## Versioning and releases

- Changesets: every PR touching a publishable package adds `.changeset/*.md` (the hook warns if missing).
- Merge to `main` ⇒ `release` workflow opens/updates the "Version Packages" PR. Merging it ⇒ tags `@tyto/<pkg>@x.y.z` and per-package `CHANGELOG.md`.
- Desktop: tag `desktop-vX.Y.Z` triggers macOS/Windows/Linux builds with electron-builder and publishes a GitHub Release with installers. Auto-update via `electron-updater` pointing at releases (epic E9).
- Pre-1.0: minor breaks, patch does not. From 1.0: regular semver.

## Workflows (`.github/workflows/`)

| File             | Trigger                                  | Does                                                                           |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| `ci.yml`         | PR, push to main                         | install (pnpm cache) → typecheck → lint → test → build. Turborepo remote cache |
| `visual.yml`     | PR touching export/raster/templates/core | Playwright + `test:visual`; uploads diffs as artifact on failure               |
| `commitlint.yml` | PR                                       | validates PR title and commits                                                 |
| `release.yml`    | push to main                             | Changesets → version PR → tags                                                 |
| `desktop.yml`    | tag `desktop-v*`                         | OS matrix, electron-builder, GitHub Release                                    |
| `labeler.yml`    | PR (`pull_request_target`)               | applies `pkg:*`/`app:*`/`docs`/`repo` labels from `.github/labeler.yml`        |

## Protections and labels

Branch protection on `main`: require PR, dismiss stale reviews, linear history, no force pushes, no deletions, and the rule applies to administrators too.

Required status checks are stored as job names, not workflow names: `check` (from `ci.yml`) and `lint` (from `commitlint.yml`). `visual.yml` is deliberately not required — it is path-filtered, and a check that never reports on most PRs would leave them permanently pending. Renaming either job changes the required context, so `tools/repo-checks/src/github-config.test.ts` fails when the names drift.

Required approvals are **0** while the project has one maintainer. Requiring one, with administrators included in the rule, would leave nobody able to merge: GitHub does not let an author approve their own PR. It goes to 1 the day a second maintainer joins.

The release workflow opens the "Version Packages" PR with `GITHUB_TOKEN`, which needs _Settings → Actions → General → Allow GitHub Actions to create and approve pull requests_ enabled. Without it Changesets fails with "GitHub Actions is not permitted to create or approve pull requests".

That job also runs with `HUSKY=0`. `prepare: husky` installs the hooks on every install, CI included, and the commit Changesets makes carries no Jira key — the commit-msg hook rejected it and killed the run. The rule is about commits a person writes; a job that commits on its own opts out of the hooks, not out of the rule.

The version PR is titled `chore(release): TYTO-0 version packages`. `lint` is a required check and reads the PR title, so a title without a key would open a PR that could never be merged; `TYTO-0` is the key this repository uses for work no card asked for.

Weekly grouped Dependabot for npm and actions. Per-package labels (`pkg:core`, `app:cli`, `docs`, `repo`) via `.github/labeler.yml`; the labels themselves have to exist in the repository. CODEOWNERS: maintainer on everything; per package once more people join.

## Line endings in Git

`* text=auto eol=lf` gives every checkout LF, on every platform. One directory is exempt with `-text`: `tools/contract-test/src/fixture/line-endings/`, where a line ending is the subject rather than the medium. `crlf.brief` is a brief saved the way an editor on Windows saves one, and the test beside it asserts the carriage returns are still there **before** it asserts the parser accepts them — without the exemption the fixture would arrive normalised and the test would pass while measuring nothing (TYTO-68).

Nothing else belongs there. A fixture that does not care about its bytes is better off LF like the rest of the repository, and `-text` also means Git will not merge the file line by line.

## Visual snapshots in Git

Reference PNGs live in Git LFS, matched by `**/__fixtures__/**/*.png` in `.gitattributes` — only the snapshot corpus, so icons and doc images stay readable in a clone without the LFS client. Any workflow that compares pixels must check out with `lfs: true`, or it diffs against a pointer file. Updating a snapshot requires an explicit commit `test(export-html): TYTO-… update snapshots` with justification in the PR.

They live under `packages/raster/src/__fixtures__/reference/`. The shape fixtures are `<artwork>.<format>.png`, one file each and not one per platform. That is measured, not assumed: the Windows and Linux renders of `shapes.feed` and `alpha.square` are identical at `threshold: 0`, 0 differing pixels, because `DETERMINISM_ARGS` in the Playwright adapter takes the host's opinions out of Skia's software rasterizer.

**Glyphs are the exception, and it is measured too.** `text.feed`, the fixture TYTO-61 added, is `<artwork>.<format>.<platform>.png` — the split this document reserved for text, now spent. Its Windows reference against the Linux render of the same commit differs on **1 664 pixels of 160 000, 1.040% at the suite's threshold, ten times the tolerance**, with a largest single-channel difference of 112 of 255. Nothing moved: the diff is glyph edges, FreeType and Skia-over-DirectWrite filling an antialiased boundary differently. It only falls under the tolerance at `threshold: 0.2`, which would leave the suite unable to see a wrong colour, so the answer is a file per platform rather than a looser number — the perturbation table in `raster.visual.test.ts` is the working.

`win32` and `linux` are committed; **`darwin` is not.** The first Mac to run the suite gets a failure naming the file to record, which is the same path any missing reference takes. Only the platform itself can record its own file, and the other platforms' files are not substitutes for it.

A font is now part of what a reference depends on: `fonts/` holds the bundled faces and `tools/test-fonts` reads them (`docs/conventions.md`). Changing either re-records the corpus, which is why both are in `visual.yml`'s path filter — a PR that swaps a font version and runs no pixel check would land a corpus nothing compared.

`pnpm test:visual` with no reference on disk **fails**, writes the render it would have compared into `__diff__/`, and names the file to commit; `visual.yml` uploads that folder on failure, so a first reference can be taken from a CI artifact. Recording locally is `UPDATE_VISUAL_REFERENCE=1 pnpm --filter @tyto/raster test:visual`, and needs `pnpm exec playwright install chromium` first.

A Playwright bump is a re-record, not a tolerance question: the diff tolerates a whole-image drift of ±1 per channel and nothing wider, which is deliberate — the measurements behind both numbers are in the header of `raster.visual.test.ts`. Re-record in its own commit, saying which browser version it moved to.

**`core.hooksPath` is `.husky/_`, so the pre-push hook `git lfs install` writes into `.git/hooks` is never read.** `.husky/pre-push` declares it where the hooks path can see it. Without that hook a plain `git push` sends the pointer files alone and `actions/checkout` fails with `Object does not exist on the server: [404]` before running a test.
