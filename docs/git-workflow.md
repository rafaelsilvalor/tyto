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
- CI runs on every PR; `test:visual` only when `packages/export-*`, `raster`, `templates` or `core` change.
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

Weekly grouped Dependabot for npm and actions. Per-package labels (`pkg:core`, `app:cli`, `docs`, `repo`) via `.github/labeler.yml`; the labels themselves have to exist in the repository. CODEOWNERS: maintainer on everything; per package once more people join.

## Visual snapshots in Git

Reference PNGs live in Git LFS, matched by `**/__fixtures__/**/*.png` in `.gitattributes` — only the snapshot corpus, so icons and doc images stay readable in a clone without the LFS client. Any workflow that compares pixels must check out with `lfs: true`, or it diffs against a pointer file. Updating a snapshot requires an explicit commit `test(export-html): TYTO-… update snapshots` with justification in the PR.
