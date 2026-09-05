# Git and GitHub

## Model: trunk-based with short-lived branches
- `main` is always releasable. Protected: PR required, green CI, 1 approval, linear history (squash merge), no direct pushes.
- One branch per card, lifetime < 3 days: `feat/TYTO-123-slug`, `fix/…`, `chore/…`, `docs/…`.
- No `develop`, no release branches. Versions come from `main` via Changesets.

## Commits
Conventional Commits with the Jira key: `feat(export-svg): TYTO-042 support <mask>`. Scope = package name. Validated by commitlint in the hook and in CI. Squash merge uses the PR title as the message — PR titles follow the same format.

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
| File | Trigger | Does |
|---|---|---|
| `ci.yml` | PR, push to main | install (pnpm cache) → typecheck → lint → test → build. Turborepo remote cache |
| `visual.yml` | PR touching export/raster/templates/core | Playwright + `test:visual`; uploads diffs as artifact on failure |
| `commitlint.yml` | PR | validates PR title and commits |
| `release.yml` | push to main | Changesets → version PR → tags |
| `desktop.yml` | tag `desktop-v*` | OS matrix, electron-builder, GitHub Release |

## Protections and labels
Branch protection on `main`: require PR, required checks `ci`, `commitlint` (and `visual` when it ran), dismiss stale reviews, linear history. Weekly grouped Dependabot for npm and actions. Per-package labels (`pkg:core`…) via `labeler.yml`. CODEOWNERS: maintainer on everything; per package once more people join.

## Visual snapshots in Git
Reference PNGs live in Git LFS (`*.png` under `__fixtures__`). Updating a snapshot requires an explicit commit `test(export-html): TYTO-… update snapshots` with justification in the PR.
