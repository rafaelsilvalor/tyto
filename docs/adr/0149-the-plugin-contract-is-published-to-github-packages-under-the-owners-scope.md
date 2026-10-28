# 0149 — The plugin contract is published to GitHub Packages under the owner's scope

Status: accepted · 2026-10-27 · TYTO-444 · amended 2026-10-28 (TYTO-448) · builds on ADR 0040, ADR 0041, ADR 0070 and ADR 0072

## Context

A plugin or a template developed in its own repository has nothing to depend on. Nothing
here is published: `release.yml` versions the packages and tags them (`changeset git-tag`),
and `tyto-plugin-jira` copies `@tyto/plugin-api`'s types by hand into `src/tyto-api.d.ts`,
pinned to the Tyto commit they came from, while `tyto-plugin-estrategia` clones Tyto in its
CI and builds `@tyto/recipe` to test against. When the host changes the contract nobody
downstream is told: `RPC_PROTOCOL_VERSION` went from 5 to 8 in four days (#179, #194, #202).

The card proposed GitHub Packages with the `@tyto` scope. **That scope is not this
repository's on either registry**, measured before anything was written:

- GitHub Packages scopes an npm package by the account that owns it. The repository's owner
  is `rafaelsilvalor`; `gh api orgs/Tyto` answers an organisation created on 2018-02-02 by
  somebody else.
- On npmjs.com the organisation `tyto` exists too: `registry.npmjs.org/-/org/tyto/package`
  answers 200 with an empty list, against 404 for an organisation that does not exist.

And `@tyto/plugin-api` cannot be published alone. It depends on `@tyto/core` and
`@tyto/recipe` through `workspace:*`, and `@tyto/template-kit` depends on `@tyto/core`.

## Decision

1. **The registry is GitHub Packages, under the owner's scope, and the workspace keeps
   `@tyto/*`.** Each package is published as `@rafaelsilvalor/tyto-<name>`, and every
   `@tyto/x` it depends on is rewritten to the npm alias
   `"@tyto/x": "npm:@rafaelsilvalor/tyto-x@<version>"`. A consumer writes the same alias for
   what it asks for — `"@tyto/plugin-api": "npm:@rafaelsilvalor/tyto-plugin-api@^0.4.1"` — and
   imports `@tyto/plugin-api` as the workspace does, because the folder in `node_modules` is
   named after the alias. Publishing under his own account was Rafael's decision on
   2026-10-27, asked against a dedicated organisation. **The prefix is one constant, `PUBLISHED_PREFIX` in
   `tools/repo-checks/src/publish-contract.mjs`**; a dedicated GitHub organisation later is
   that line and a line here, and no workspace name changes.
2. **The contract is `@tyto/plugin-api` and `@tyto/template-kit`**, and the package TYTO-431
   creates, `_casa`, joins them when it exists. `@tyto/core` and `@tyto/recipe` are published
   as what the contract imports — **not bundled into it**: a bundled core is two copies of
   `Scene` the day a template installs both packages, and a version of the contract that hides
   which core it carries. The list is `CONTRACT_PACKAGES` in the same script, dependencies
   first; `publish-contract.test.mjs` fails if a listed package depends on a workspace package
   outside it, or before it. The licence stays `UNLICENSED`: a registry package is read with a
   token, and the repository being public does not change what the licence grants.
3. **Changesets versions and tags these packages and never publishes them.** `changeset
publish` uploads every package that is not private — sixteen here — so it is not used. The
   release run that tags (the one where no changeset is left, `hasChangesets == 'false'`) then
   runs `publish-contract.mjs` with the workflow's token and `packages: write`. It packs each
   package with pnpm, which resolves `workspace:*` to a version, rewrites the manifest (name,
   aliases, `repository`, `publishConfig`; no `scripts`, no `devDependencies`), and publishes
   with `npm publish --ignore-scripts`, skipping a version the registry already holds. `ci.yml`
   runs it with `--dry-run` on every pull request, after the turbo run that built `dist/`.
4. **A protocol change is a breaking release of `@tyto/plugin-api`.** On 0.x a caret range
   only moves through patches, so a protocol bump released as a patch would reach a plugin
   pinned at `^0.4.1` through an ordinary update and be refused at `hello`. Released as a minor
   — a major from 1.0 — it falls outside that range. `changeset-coverage.mjs` compares
   `RPC_PROTOCOL_VERSION` at the merge base and at the head, and fails a branch that moves it
   without adding a changeset giving `@tyto/plugin-api` that bump (`protocol-bump.mjs`).
5. **The engine follows for free.** A manifest's `engine` is checked against
   `PLUGIN_API_VERSION`, which is `@tyto/plugin-api`'s own version (ADR 0040). So the version a
   plugin's repository installs is the number its manifest is checked against: a plugin tests
   `satisfiesEngine(manifest.engine, PLUGIN_API_VERSION)` against the installed package rather
   than a copied file, and the minor a protocol change forces is the same minor that makes a
   host refuse a manifest asking for `^0.4`.

## Consequences

- A consumer needs two lines of `.npmrc` and a token with `read:packages`, even though the
  repository is public: GitHub's npm registry asks for a token to install any package.
  `docs/plugin-authoring.md` has them.
- Every consumer writes the alias. A plain `"@tyto/plugin-api": "^0.4.1"` asks npmjs.com, where
  nothing by that name exists.
- The first publish creates the four packages, linked to this repository by `repository`.
  Nothing in a pull request measures it; the dry run proves the pack and the manifest, not the
  upload or the token's permission.
- A version PR that bumps none of the four publishes nothing; a rerun of a release publishes
  nothing twice.

## Amendment — 2026-10-28 · TYTO-448: publish on every push, before the action

Decision 3 gated the publish on `hasChangesets == 'false'`, after `changesets/action`. It never
ran. Version PR #24 merged as `b47a5dc`, and release run 40616244062 skipped the step: three
changesets on `main` named only `@tyto/docs` and `@tyto/repo-checks`, which carry no
`version` field, so `changeset version` skipped them, they stayed in `.changeset/`, and the
action reported changesets left and opened #208 with no files. Any changeset like that holds
every later release the same way.

1. **The publish step runs on every push to `main`, before `changesets/action`, with no
   condition.** The script already skips every version the registry holds, so the gate bought
   nothing but the failure above. It cannot simply drop the gate and stay after the action:
   when changesets are left, `changesets/action@v2` switches the checkout to
   `changeset-release/main`, writes the next versions into it and does not switch back, so a
   step after it would publish versions no release has made. Before the action the checkout
   is `main`, whose versions move only when a version PR merges.
2. **A changeset may not name a package without a `version` field.** Those packages stay
   unversioned — the manual is built from the desktop app's version (ADR 0101) and `tools/*`
   never ship. `changeset-coverage.mjs` fails a branch that adds such a changeset, and
   `changesets.test.ts` fails one already in `.changeset/`. A change that ships nothing
   versioned takes `pnpm changeset add --empty`, which `changeset version` does consume. The
   three stale files were deleted with this amendment.

Consequences:

- **A failed upload now fails the release job before the version PR is refreshed** — no
  `continue-on-error`, on purpose. A red release run reads "publish failed" first, and the
  version PR catches up on the next green push.
- The first upload is the push that merges this amendment: `main` already holds
  `@tyto/plugin-api` 0.5.0, `@tyto/core` 0.29.0, `@tyto/recipe` 0.1.0 and
  `@tyto/template-kit` 0.2.2 from #24, none of them published.
- `github-config.test.ts` pins the step's position, the absent condition and the absent
  `continue-on-error`.

## Rejected

- **Another GitHub organisation.** The scope would be that organisation's name, so it is this
  decision with another word, plus a token that reaches across accounts.
- **Tarballs attached to a GitHub release.** No token for a public repository, but no ranges:
  `^0.4` cannot resolve to a URL, and a transitive `@tyto/core` needs `pnpm.overrides` in every
  consumer.
- **Bundling core and recipe into plugin-api.** It does not solve the scope, and two packages
  that each bundle core disagree about which `Scene` a template returns.
- **Renaming the workspace to `@rafaelsilvalor/*`.** Every import in the repository changes, and
  changes again if the owner does.
