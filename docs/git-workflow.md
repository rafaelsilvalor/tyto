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
- CI runs on every PR; `test:visual` only when `packages/export-*`, `raster`, `templates`, `core` or `fonts` change.
- Optional PR bot (Claude Code Action) reviews against `CLAUDE.md`.

## Versioning and releases

- Changesets: every PR touching a publishable package adds `.changeset/*.md` (the hook warns if missing).
- Merge to `main` ⇒ `release` workflow opens/updates the "Version Packages" PR. Merging it ⇒ tags `@tyto/<pkg>@x.y.z` and per-package `CHANGELOG.md`.
- Desktop: tag `desktop-vX.Y.Z` triggers macOS/Windows/Linux builds with electron-builder and publishes a GitHub Release with installers. Auto-update via `electron-updater` pointing at releases (epic E9).
- Pre-1.0: minor breaks, patch does not. From 1.0: regular semver.

### The desktop release

**The tag does not set the version; it has to agree with it.** electron-builder reads the version from `apps/desktop/package.json` and takes the release name from the tag, and it never compares the two — `desktop-v0.2.0` pushed over a package still reading `0.1.0` publishes `Tyto Setup 0.1.0.exe` into a release called `desktop-v0.2.0`, green. So `desktop.yml`'s first step after `setup-node` compares `GITHUB_REF_NAME` against the manifest and fails the job before the install. Cutting a desktop release is therefore two steps: bump `apps/desktop/package.json`, then tag the version you bumped to.

Three runners, `fail-fast: false`, one installer each: `dmg`, `nsis`, `AppImage`. All three `--publish always` into the same release, and cancelling the survivors of a failed leg would leave that release holding whichever finished first with nothing saying what was cut short. macOS builds on `macos-latest`, which is Apple Silicon, so the `dmg` is **arm64 only** — an Intel build is a second matrix entry whenever somebody needs one.

**The job builds with `pnpm build` and not with `pnpm --filter @tyto/desktop build`.** The filtered form runs the package's own script and nothing before it, so on a fresh checkout — which every tag build is — the workspace packages have no `dist/` and the bundle dies at `Rolldown failed to resolve import "@tyto/core" from "apps/desktop/src/main/plugins.ts"`. Turborepo's `^build` is what orders them. The file carried the filtered form from the bootstrap commit until TYTO-15, which is to say it had never been run.

**What ships is three bundles and one data folder.** `electron.vite.config.ts` bundles the workspace packages into `out/main/index.js` on purpose — a pnpm `node_modules` is a tree of symlinks, and an installer built from one works on the machine that built it — so the default `files`, which collects every production dependency, ships a second copy of code the bundle already holds: **2 161 entries and 20 196 010 bytes** of `app.asar`, including 54 Turborepo build logs, 224 `src/` files and 68 test fixtures. `electron-builder.yml` excludes `node_modules` and re-includes one package, giving **27 entries and 2 015 370 bytes**.

The package that comes back is not code. `activateBuiltIns` reads the built-in template pack off disk at startup and finds it with `createRequire(...).resolve('@tyto/templates/package.json')` — a resolver call, which a bundle cannot answer. Drop the two lines and the packaged app **opens no window at all**: the resolve throws inside the promise `app.whenReady().then(start)` returns, nobody is listening for the rejection, and the process sits there having logged nothing. `apps/desktop/e2e/packaged.package.test.ts` packages the app and launches it, and is the only thing in the repository that measures an installer rather than a file. It is not in `pnpm check` — `pnpm --filter @tyto/desktop test:package`, ~23 s once the Electron zip is cached — the same arrangement `packages/raster` makes for its visual suite.

**The desktop build output is declared to Turborepo for the same reason.** `apps/desktop` is the one package that does not build to `dist`, and declaring only `dist/**` did not make its build uncacheable — it made it cacheable with nothing in the cache, so a second `pnpm build` printed `@tyto/desktop:build: cache hit, replaying logs` and left `apps/desktop/out` absent. In a job that builds and then packages, that hit is an installer wrapped around an empty app.

**Signing is optional and off.** With `CSC_LINK` unset electron-builder finds no identity and ships unsigned installers; macOS warns on first open and Windows SmartScreen does the same. Turning it on is two repository secrets, `CSC_LINK` (a base64 `.p12`) and `CSC_KEY_PASSWORD`, which `desktop.yml` already passes through. Notarizing a macOS build additionally wants `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, and is a separate decision — an unsigned app that is notarized is not a thing. No icon is set either: macOS and Windows use the one embedded in the Electron skeleton and `ElectronFramework.getDefaultIcon` hands Linux its bundled `electron-linux` set, so the AppImage build does not fail for the lack of one, it ships Electron's.

`tools/repo-checks/src/desktop-release.test.ts` pins the couplings above, because **`desktop.yml` does not run on a pull request** — nothing in CI executes it, so a mistake in it lands green and is found by whoever cuts the release. Measured rather than asserted: five perturbations, each caught by exactly one test, against a baseline of 0 of 113 failing.

**Release tags are lightweight, and that is a decision rather than a leftover.** `changesets/action` v2 pushes tags through the GitHub API instead of the Git CLI, and an API ref is a plain ref — so since TYTO-80 every `@tyto/<pkg>@x.y.z` is a `commit` object where the older ones are `tag` objects (24 lightweight against 125 annotated, measured 2026-09-13). `push-with-git-cli: true` would restore the old shape, and it is deliberately absent from `release.yml`.

What the annotated ones actually carried is the reason. They were **not signed** — `git cat-file tag '@tyto/core@0.19.0' | grep -c "BEGIN PGP"` is `0` — so no signature was traded away in either direction, which is the thing the choice looks like it is about and is not. What they had was a tagger reading `github-actions[bot]`, a date the tagged commit already carries, and a message repeating the tag's own name. Against that, the one real cost of a lightweight tag is `git describe` needing `--tags`, and `git describe` has **0 occurrences** in this repository. Nothing here reads these tags; npm and the GitHub Releases both work off the commit.

So the annotated form would buy a bot's name and a duplicate date, and the API form is what the action does with no configuration. `github-config.test.ts` pins it, in both directions, so adding that input for an unrelated reason fails instead of quietly changing the shape of every future release tag. **If it is ever added on purpose, this paragraph changes in the same commit.**

**`@changesets/cli` and `changesets/action` have one major between them, not two.** The action's v1 runs against CLI v2 and its v2 against CLI v3, and each refuses the other by name — so bumping either alone is not a bump. The pair here is CLI v3 with `changesets/action@v2` (TYTO-80).

Crossing that major renamed every input the workflow passes — `version` → `version-script`, `publish` → `publish-script`, `commit` → `commit-message`, `title` → `pr-title` — and **an action ignores an input it does not know rather than failing on it**, so the whole class of mistake is silent. The v1 → v2 bump left `commit:` and `title:` in the file meaning nothing and opened the version PR under the action's own default title, "Version Packages": a green run and a pull request with no Jira key, unmergeable for good (TYTO-78). `github-config.test.ts` pins each major's full input list from its `action.yml` and reads the linted strings through the names the pinned major uses, so a leftover name fails instead of doing nothing. Measured both ways rather than asserted: `title:` under v2 fails **2 of 30** tests, and the same file with v2's names passes **30 of 30**.

The CLI's own major renamed a command: `changeset tag` is `changeset git-tag`. The old spelling still tags and prints `The 'tag' command is deprecated. Please use 'git-tag' instead.` — a countdown rather than a pass, so `release.yml` runs `git-tag`. Two other v3 changes matter here and neither bites yet: `changeset version` now exits 1 when no unreleased changeset exists (the action only runs it when there are changesets), and private packages are no longer versioned by default (nothing in `tools/` was ever meant to be).

## Workflows (`.github/workflows/`)

| File             | Trigger                                  | Does                                                                           |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| `ci.yml`         | PR, push to main                         | install (pnpm cache) → typecheck → lint → test → build. Turborepo remote cache |
| `visual.yml`     | PR touching export/raster/templates/core | Playwright + `test:visual`; uploads diffs as artifact on failure               |
| `commitlint.yml` | PR                                       | validates PR title and commits                                                 |
| `release.yml`    | push to main                             | Changesets → version PR → tags                                                 |
| `desktop.yml`    | tag `desktop-v*`                         | tag/version guard → OS matrix → electron-builder → GitHub Release              |
| `labeler.yml`    | PR (`pull_request_target`)               | applies `pkg:*`/`app:*`/`docs`/`repo` labels from `.github/labeler.yml`        |

## Protections and labels

Branch protection on `main`: require PR, dismiss stale reviews, linear history, no force pushes, no deletions, and the rule applies to administrators too.

Required status checks are stored as job names, not workflow names: `check` (from `ci.yml`) and `lint` (from `commitlint.yml`). `visual.yml` is deliberately not required — it is path-filtered, and a check that never reports on most PRs would leave them permanently pending. Renaming either job changes the required context, so `tools/repo-checks/src/github-config.test.ts` fails when the names drift.

Required approvals are **0** while the project has one maintainer. Requiring one, with administrators included in the rule, would leave nobody able to merge: GitHub does not let an author approve their own PR. It goes to 1 the day a second maintainer joins.

The release workflow opens the "Version Packages" PR with the workflow token, which needs _Settings → Actions → General → Allow GitHub Actions to create and approve pull requests_ enabled. Without it Changesets fails with "GitHub Actions is not permitted to create or approve pull requests".

**The token arrives through the `github-token` input, not through the environment.** `changesets/action` v2 stopped reading `GITHUB_TOKEN` — the input defaults to `${{ github.token }}`, and a custom token has to be passed explicitly. `release.yml` therefore carries no `env:` for it: the default is exactly the token the removed line was handing over. A repository that needs a different token sets the input, and setting the variable instead would do nothing and say nothing.

That job also runs with `HUSKY=0`. `prepare: husky` installs the hooks on every install, CI included, and the commit Changesets makes carries no Jira key — the commit-msg hook rejected it and killed the run. The rule is about commits a person writes; a job that commits on its own opts out of the hooks, not out of the rule.

The version PR is titled `chore(release): TYTO-0 version packages`. `lint` is a required check and reads the PR title, so a title without a key would open a PR that could never be merged; `TYTO-0` is the key this repository uses for work no card asked for.

**Dependabot is the other robot, and it gets an exemption rather than a key.** `chore(deps)` and `chore(deps-dev)` may omit the Jira key — the only subjects that may. Changesets could be given `TYTO-0` because the workflow writes its own title; Dependabot writes both the title and the commits, so the exemption has to live in `commitlint.config.js`, and it is keyed on the **scope** rather than on the author so a person bumping a dependency by hand is held to the same rule as the robot. `tools/repo-checks/src/commit-message.test.ts` pins both sides of the hole. Measured before it was opened: the first five Dependabot PRs failed `lint` and nothing else (TYTO-76).

Weekly grouped Dependabot for npm and actions — `dev`/`prod` for npm, one `actions` group for the workflows, so a week of bumps is one pull request and one update-and-rerun cycle instead of five. Per-package labels (`pkg:core`, `app:cli`, `docs`, `repo`) via `.github/labeler.yml`; the labels themselves have to exist in the repository. CODEOWNERS: maintainer on everything; per package once more people join.

**`packageManager` is pinned to pnpm 11 because the npm updater runs on it, and pnpm 12 cannot run where the updater runs.** Dependabot installs whatever that field names into a container whose only route to the network is a proxy. pnpm 12 publishes a launcher rather than the program, and on the Corepack path — the one Dependabot takes, because Corepack installs no optional dependencies — the launcher downloads `@pnpm/exe.<target>` itself. That download is a bare `fetch` with no dispatcher (`get-pnpm/lib/registry.js`), so it cannot honour `HTTP(S)_PROXY`, and the error the log shows is that function's own: `Could not reach https://registry.npmjs.org/@pnpm/exe.linux-x64/12.3.4: fetch failed`. Under pnpm 12 the run failed **3 of 3** times, all eleven dependencies dying at `update_files` with `unknown_error` and a `null` detail; in the private job log of 2026-09-12 (`job_1572596408`), **0 of the proxy's 120 requests** were for `@pnpm/exe` (TYTO-79).

The move cost less than it looked like it would, which is why it was made rather than argued about (TYTO-82). pnpm 11.27.0 ships no launcher — no `native-binary.mjs`, no `install.js`, no `@pnpm/exe.*` optional dependencies, 21 MB of JavaScript in `dist/` that Node runs directly — so it cannot need a second download. Regenerating the lockfile under it changed **101 lines of 4 567**, every one of them pnpm 12 and its eight platform binaries leaving the file or a `settings:` header arriving, and **0 of the project's own 472 packages** changed resolution. `lockfileVersion` stays `'9.0'`. Waiting for an upstream fix was rejected on measurement: the downloader in 12.4.1 is byte-identical to the one in 12.3.4, and nothing under `get-pnpm/` mentions a proxy agent.

`tools/repo-checks/src/github-config.test.ts` holds the pin and the note in `.github/dependabot.yml` to the same pnpm major, so leaving pnpm 11 fails the suite and the reasoning is re-read rather than inherited.

**One `ignore` entry left, and it exists because a group is a single pull request.** A rejected bump is not one bump waiting: the weekly run updates that same pull request, so every later bump in its group — a security one included — queues behind whatever is blocking it. `typescript` 6.x and 7.x are skipped for two different reasons, found one after the other: typescript-eslint refuses TS 7 by name, and `tsup` fails every declaration build under TS 6 because it sets `baseUrl` whether the project asked for one or not (`TS5101`; tsup 8.5.1 is the latest published and still does it). The entry is narrow — the majors being refused, never `version-update:semver-major` — so a later major is still offered, and adopting either stays a stack change that wants an ADR (TYTO-84).

**The second entry is gone, and its removal is the shape an `ignore` is supposed to have.** `changesets/action` 2 was skipped while this repository ran Changesets CLI v2, which the action's v2 refuses to run against — a migration wearing a version number's clothes (TYTO-78, TYTO-83). TYTO-80 did the migration, so the refusal had nothing left to refuse and went out in the same pull request. `github-config.test.ts` is what made that simultaneous rather than remembered: it fails the moment a workflow uses a major the config still ignores.

**The spelling differs by ecosystem, and getting it wrong fails silently.** An npm version is semver, so `7.x` is the range that matches it. A GitHub Actions version is the **ref** the workflow pins — `2`, the way `actions/checkout` is `7` — so a semver range matches nothing there and the entry must read `2`. The first attempt spelled it `2.x`; Dependabot accepted the condition, printed it back as an ignored version, and opened the pull request anyway. The difference is visible only in the updater log, as `Available release version/ref is <v>` under `Checking if <action> … needs updating`: it read `2` while the entry was wrong and `1` once it was right.

An `ignore` is a refusal with no expiry date written on it, and Dependabot never reports what it skipped, so `github-config.test.ts` fails once the workflows or the manifests move to a major being ignored. That check compares files and **cannot tell whether Dependabot honoured any of it** — it passed green on the `2.x` entry that ignored nothing. Only a real updater run measures that.

## Line endings in Git

`* text=auto eol=lf` gives every checkout LF, on every platform. One directory is exempt with `-text`: `tools/contract-test/src/fixture/line-endings/`, where a line ending is the subject rather than the medium. `crlf.brief` is a brief saved the way an editor on Windows saves one, and the test beside it asserts the carriage returns are still there **before** it asserts the parser accepts them — without the exemption the fixture would arrive normalised and the test would pass while measuring nothing (TYTO-68).

Nothing else belongs there. A fixture that does not care about its bytes is better off LF like the rest of the repository, and `-text` also means Git will not merge the file line by line.

## Visual snapshots in Git

Reference PNGs live in Git LFS, matched by `**/__fixtures__/**/*.png` in `.gitattributes` — only the snapshot corpus, so icons and doc images stay readable in a clone without the LFS client. Any workflow that compares pixels must check out with `lfs: true`, or it diffs against a pointer file. Updating a snapshot requires an explicit commit `test(export-html): TYTO-… update snapshots` with justification in the PR.

They live under `packages/raster/src/__fixtures__/reference/`. The shape fixtures are `<artwork>.<format>.png`, one file each and not one per platform. That is measured, not assumed: the Windows and Linux renders of `shapes.feed` and `alpha.square` are identical at `threshold: 0`, 0 differing pixels, because `DETERMINISM_ARGS` in the Playwright adapter takes the host's opinions out of Skia's software rasterizer.

**Glyphs are the exception, and it is measured too.** `text.feed`, the fixture TYTO-61 added, is `<artwork>.<format>.<platform>.png` — the split this document reserved for text, now spent. Its Windows reference against the Linux render of the same commit differs on **1 664 pixels of 160 000, 1.040% at the suite's threshold, ten times the tolerance**, with a largest single-channel difference of 112 of 255. Nothing moved: the diff is glyph edges, FreeType and Skia-over-DirectWrite filling an antialiased boundary differently. It only falls under the tolerance at `threshold: 0.2`, which would leave the suite unable to see a wrong colour, so the answer is a file per platform rather than a looser number — the perturbation table in `raster.visual.test.ts` is the working.

`win32` and `linux` are committed; **`darwin` is not.** The first Mac to run the suite gets a failure naming the file to record, which is the same path any missing reference takes. Only the platform itself can record its own file, and the other platforms' files are not substitutes for it.

A font is part of what a reference depends on: `packages/fonts` holds the bundled faces and reads them (`docs/conventions.md`). Changing either the bytes or the reader re-records the corpus, which is why that package is in `visual.yml`'s path filter — a PR that swaps a font version and runs no pixel check would land a corpus nothing compared.

`pnpm test:visual` with no reference on disk **fails**, writes the render it would have compared into `__diff__/`, and names the file to commit; `visual.yml` uploads that folder on failure, so a first reference can be taken from a CI artifact. Recording locally is `UPDATE_VISUAL_REFERENCE=1 pnpm --filter @tyto/raster test:visual`, and needs `pnpm exec playwright install chromium` first.

A Playwright bump is a re-record, not a tolerance question: the diff tolerates a whole-image drift of ±1 per channel and nothing wider, which is deliberate — the measurements behind both numbers are in the header of `raster.visual.test.ts`. Re-record in its own commit, saying which browser version it moved to.

**`core.hooksPath` is `.husky/_`, so the pre-push hook `git lfs install` writes into `.git/hooks` is never read.** `.husky/pre-push` declares it where the hooks path can see it. Without that hook a plain `git push` sends the pointer files alone and `actions/checkout` fails with `Object does not exist on the server: [404]` before running a test.
