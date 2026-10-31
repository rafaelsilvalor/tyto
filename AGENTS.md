# AGENTS.md — Tyto

The rules every coding agent follows in this repository. Codex reads this file directly;
Claude Code reads it through `CLAUDE.md`. Change a rule here, never in a copy. `docs/agents.md`
says how the two tools map onto each other.

Read `docs/architecture.md` before any task. Decisions in `docs/adr/` are closed; do not reopen them without a new ADR.

## Language

- Code, identifiers, comments, docs, commit messages, PR titles/bodies, Jira cards: **English**.
- One exception (ADR 0101): the user manual in `apps/docs` has two editions, English at `/` and Brazilian Portuguese at `/pt-BR/`. English is the source; a page added to one edition is added to the other in the same PR (a parity test fails otherwise). The author guides it includes from `docs/` stay English-only. Contributor docs, ADRs, code, commits and cards stay English.
- The maintainer (Rafael) reads English fine but writes in **Portuguese**. He will talk to you in Portuguese; reply in Portuguese in chat. Everything you _produce_ in the repo stays in English — code, docs, commits, PRs. Quoting English code or docs to him needs no translation.
- Jira cards: title and body in English, followed by a `---` and a Portuguese half. That half is **not a translation** — he reads English fine, so translating the technical body twice buys nothing. It explains, for somebody who does not write code, **what the card adds to Tyto**: one concrete example of what a person can do afterwards that they could not do before, and one sentence on what still does not work. Three sentences to a short paragraph.
- Cards written before 2026-09-11 carry a compressed Portuguese translation instead. They are not retrofitted on sight: a closed card is history, and an open one gets the new half when somebody picks it up.

## What this is

Compiler: brief → Scene IR → exporters (HTML→raster, SVG), plus an Electron app, a CLI and a plugin system. See `README.md`.

## Hard rules

- `packages/core`, `brief-lang`, `template-lang`, `export-*`, `templates`, `template-kit`, `house-style`, `theme-pack`, `recipe`: **no Node or DOM imports**. Pure TS, any runtime. This is what makes the cloud possible later. Enforced by lint.
- No exceptions for expected errors. Stages return `Result<T, Diagnostic[]>`. Diagnostics carry a source `range`.
- Exporters never receive an AST or a brief — only `Scene`. If something must appear in the output, it enters the IR first.
- Every adapter (fs, chromium, http…) implements a port from `core` or `plugin-api`. No package imports another package's adapter; composition happens in `apps/*` only.
- Built-in is a plugin. If a feature does not fit an existing extension point, extend `plugin-api`; do not bypass it.
- Electron: `contextIsolation: true`, `nodeIntegration: false`, typed preload only. Credentials only through `safeStorage`.
- Tyto knows no provider (ADR 0011, ADR 0127): Jira, Google, Drive and the like live only in installed plugins in their own repositories. The core gains generic services (secrets, storage, OAuth 2.0 as a protocol, recipe verbs), never a provider's name or API, and never machine identity.
- The repository is public. No logo, signature, brand name or real marketing copy is committed; tests use neutral fixtures. Production templates live in their own repositories, never in `packages/templates`, which holds only test templates (ADR 0151).

## Workflow

1. Take the highest-priority TYTO card in **Ready** (Jira); To Do is the backlog, never picked from on your own. Read the spec it references in `docs/`, and grep the code it names first: a card's premise may be stale.
2. Branch `feat/TYTO-123-slug` (or `fix/`, `chore/`, `docs/`) from `origin/main`. Never stack a PR on another card's branch.
3. Implement with tests (Vitest). Exporters require fixture + snapshot (`__fixtures__/*.brief` → `*.html`/`*.svg`; raster uses PNG diff with tolerance). Desktop e2e only for what needs the real window; logic goes to unit or jsdom tests, and an e2e file has a 60 s budget on CI (`docs/conventions.md` › Tests, ADR 0105).
4. `pnpm check` (typecheck + lint + test) must pass.
5. Conventional Commit with the key: `feat(core): TYTO-123 add Frame schema`.
6. If the task changed a decision or created a convention, update the doc or add an ADR in the same PR.
7. Open a **draft** PR, move the card to Review. Never move to Done and never merge — the human does.

## Stack (do not change without an ADR)

pnpm workspaces + Turborepo · TypeScript strict · Zod · Vitest · Playwright · ESLint flat + Prettier · tsup (libs) · electron-vite (desktop) · CodeMirror 6 + Lezer · commander (CLI) · VitePress (user manual) · Changesets.

## Style

No cryptic abbreviations. Small functions, explicit types at package boundaries. Comments explain _why_, not _what_.

## Operational rules

Learned from past mistakes on this repository. Each one cost a red CI run or a wrong claim.

### Commits and pull requests

- Subject at most 72 characters; body lines wrapped near 78 (commitlint warns above 100, and a `BREAKING CHANGE:` footer over 100 is an error). One `-m` per paragraph.
- A body paragraph never starts with `Word: ` — commitlint reads it as a footer. Check `git log -1` before pushing.
- No trailers in commits or PR bodies: no `Co-Authored-By`, no "Generated with".
- Loose ends go under a literal `## Left open` heading in the PR body; a sweep greps for it. Fix a loose end found on the card's path in the same PR when its diff is smaller than the card's, and say so with both diff sizes.
- Every versioned package a PR touches needs its own changeset (`pnpm changeset add --empty` when nothing ships). Compare `git diff --name-only origin/main` with the changeset's package names; `pnpm changeset status` alone has passed while CI failed.
- An ADR number is used only once reserved; confirm it is still free on `origin/main` right before pushing.
- About 1,500 changed lines per PR at most; above that, propose a split.

### Branches, CI and merging

- Two open PRs in the same package conflict; keep one. Resolve `pnpm-lock.yaml` by taking main's and running `pnpm install --lockfile-only`.
- After every push, compare the PR's head SHA with `HEAD`. `* [new branch]` on a branch that had a PR means it was merged: a push after a merge orphans the commit. Branch from `origin/main` and cherry-pick.
- Delete a local branch only when `gh pr list --state all --head <branch>` says MERGED or CLOSED and its tip is the PR's head (or an ancestor of it); use `git branch -D`.
- Before deleting a file you believe untracked, require `??` from `git status --short <path>`.
- CI checks can take minutes to appear; re-query before concluding a run did not start. `gh pr checks <n> --watch` exits when the checks that exist so far finish. When GraphQL errors break it, read `gh api repos/<owner>/<repo>/commits/<sha>/check-runs`.
- After "Update branch", if the PR's `headRefOid` differs from the latest run's `headSha`, close and reopen the PR to trigger CI.
- Auto-merge waits only for required checks; never arm it as a substitute for reading every check on the current head SHA.
- A green PR proves `ci.yml` only: `release.yml` runs on push to main and `desktop.yml` publishes on a `desktop-v*` tag. Say which workflows a PR did not exercise.
- Before blaming your diff for an e2e red, check CI on the same commit and main's history (`gh run list --workflow=desktop-e2e.yml --branch main`).
- A Dependabot PR closes itself once an `ignore` rule matches; GitHub Actions versions in `ignore` are refs (`'2'`), npm versions are semver (`'7.x'`).
- A new `.github/labeler.yml` rule never labels its own PR. A new `apps/<name>` also needs an entry in the lists of `tools/repo-checks/src/changesets.test.ts`.
- A push that fails with an LFS lock or a 500 is retried as a plain push a minute later. After any push carrying LFS files, run `git lfs push --all origin <branch>` and require "Uploading LFS objects".
- Desktop release: bump `apps/desktop/package.json`, push tag `desktop-v<version>`; the release is born draft. List drafts with `gh release view <tag>`, never `gh release list`.

### Building

- `apps/desktop` depends on node-pty, a native module (ADR 0164): `pnpm install` compiles it on
  Linux, and packaging (`test:package`, electron-builder) compiles it on every platform. That
  machine needs a C++ toolchain: Visual Studio Build Tools, Xcode's command-line tools, or gcc
  and make.
- In a fresh worktree, `node_modules` must exist before the first commit (the pre-commit hook would install everything), and `pnpm -r generate:parser` runs before the first build.
- Desktop e2e runs the built bundle in `apps/desktop/out`: `TURBO_FORCE=1 pnpm build` first, never `--filter=@tyto/desktop...`, which skips the CLI some suites run.
- A filtered vitest run reads other packages' `dist`: after changing `packages/core`, `pnpm --filter @tyto/core build` first. Docs tests read the built site: `pnpm --filter @tyto/docs build` after a page edit.
- `pnpm check` can be all cache: use `TURBO_FORCE=1` when anything outside the hash changed, and require `Cached: 0 cached`. It stops at the first failure and runs neither changeset checks nor `*.desktop.test.ts`; for evidence run `TURBO_FORCE=1 pnpm exec turbo run typecheck lint test --continue`.
- While a check runs in the background, touch nothing in the tree.
- After switching branches, delete package folders that hold only `.turbo` or `node_modules`; repo-checks scans folders on disk.
- After settings, commands, status bar or font changes, update the generated reference pages: `cd tools/docs-gen && pnpm exec vitest run --update src/reference/pages.test.ts`.
- Check `pnpm-lock.yaml` for an optional peer before adding a dependency; `auto-install-peers` makes an add irreversible. Never perturb `packageManager` in `package.json`.
- `@tyto/fonts` and `@tyto/templates` ship without `node_modules`: only Node built-ins may be imported there.
- To expose a dependency's type, write a local alias (`export type X = Imported`); tsup drops the `type` modifier from `export type { X }`.
- A string a packaged test greps in the bundle is written whole in source, never as a template literal.
- When touching `turbo.json` outputs, delete the output folder, run twice, and require it exists after the cache hit.

### Tests

- Before claiming a new test closes a gap, perturb the real mechanism, run it and its neighbours, and report who caught it. The perturbation must compile. Back up an uncommitted file with a copy before perturbing it, and restore by copy, never `git checkout`.
- "Timeout waiting for worker" with no `AssertionError` is machine load, not the diff: rerun with `--maxWorkers=2`, and let CI gate.
- Never anchor a grep with `^` on vitest output: the first line carries an ANSI prefix. Numbers a passing test must show in CI go through `process.stdout.write`; in jsdom, `console` is swallowed.
- Hunt a timing flake in two arms, idle and under load, with the old code under the same load as control.
- Functions taking an injected `platform` use `path.win32` or `path.posix`, never bare `node:path`; Linux CI catches it.
- Probe names must differ beyond letter case, with a control arm that must stay empty.
- `node_modules` scans prove only the local platform; Linux CI is the arbiter.
- Observe an adapter through a typed injection seam, never `vi.mock('playwright')`, which leaks a real browser. Never write the real OS clipboard in a probe.
- Probe the brief parser through a temporary `*.test.ts` in `packages/brief-lang/src`.
- Scan imports with TypeScript's `preProcessFile`, never a regex (a regex reads comments).
- In grep patterns, accented letters become `.{1,2}`; bracket classes miss multibyte UTF-8.
- Never assert the whole diagnostics list of a render that uses machine fonts: CI lacks them and adds `W_FONT_SUBSTITUTED`. Filter by code.

### Desktop app and e2e

- Locally run typecheck, lint, the unit tests of the packages you touched and only the e2e files you added or changed; the draft PR's CI runs the full `test:desktop`.
- Every e2e launch gets its own `--user-data-dir` and `TYTO_HOME`, and closes with `closeApp(app)` from `e2e/close-app.ts`.
- Desktop e2e is Vitest plus the Playwright library: no `toBeVisible`; wait with `waitForSelector` or `waitForFunction`. Click an `aria-disabled` control with `force: true`. Scroll with `page.mouse.wheel`, and wait for CodeMirror's async scroll on a condition. `.cm-content` holds only the viewport.
- A new IPC channel enters `shared/ipc.test.ts` and the channel list of `window.desktop.test.ts`; i18n keys never shown as element text go in `NOT_ELEMENT_TEXT`. A new file under `apps/desktop/src` or `e2e` enters `tools/repo-checks/src/desktop-e2e-map.json`.
- Electron main starts child processes with `spawn` and `stdio: 'ipc'`, `serialization: 'json'`, never `fork` (the RunAsNode fuse is off). IPC to plain Node needs JSON, with the `plugin-wire.ts` markers for `Uint8Array` and `undefined`.
- A layout change is looked at in the real window before the PR; jsdom does no layout. Pair every capture with a control at the same wait. Read a sandboxed `srcdoc` frame from inside (`contentFrame().content()`) before calling it cut or stale.
- An isolation claim is proven by the real data folder's modification times before and after the run, not by the pass count. A sandbox claim is proven by a read that must fail in the exact process.
- Before measuring the packaged app, read the version inside `app.asar`; a stale package predates the bump.

### Templates, fonts and exporters

- Validate exporter output visually in the system Chrome (`channel: 'chrome'`) with real raster bytes. In `packages/raster`, reach the DOM inside `page.evaluate` through a local interface cast from `globalThis`.
- A rendering template fixture needs a `template.html` with geometry in `<style>`, the CSS `font` shorthand, a top-level `formats.yaml` map and manifest `slots:`. `promo-curso` and `carrossel-lista` are throwaway test templates.
- Run Prettier only on the files you edited, never on a templates folder: it rewrites template markup into a syntax error.
- Single-colour icons enter as path geometry with colour from the template; illustrations as RGBA PNG. An SVG with a `<style>` block loses it on the way.
- In PIL image diffs, `getbbox` on RGBA reads only alpha: convert to RGB, and run a control that must differ.
- Company rules, vocabulary and field ids never enter plugin or core code; they are recipe or workspace configuration over generic verbs.
- Docs write app-data paths as shapes (`<appData>/Tyto/<version>/logs`), never a literal version.

### Measuring and reporting

- Never claim what you did not measure; say "read in the code" when that is what it was. Paste command output verbatim.
- Explain a measured number only after isolating its mechanism in the real artifact; otherwise write "cause unknown".
- Re-query a card's, a PR's or a check's state right before asserting it.
- "Espere" (wait) means stop: start nothing until the maintainer answers. A reply that corrects a detail is not a yes.
