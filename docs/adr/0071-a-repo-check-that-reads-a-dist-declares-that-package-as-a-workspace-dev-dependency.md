# 0071 — A repo-check that reads a package's dist declares that package as a workspace devDependency

Status: accepted · 2026-10-09 · TYTO-118

## Context

TYTO-115 wrote `export type { EditorState };` in `packages/editor/src/editor.ts`. tsup's
declaration rollup emitted it as `export { EditorState } from '@codemirror/state'`, without the
`type` modifier, while `dist/index.js` exported nothing of the name. `EditorState` is a class in
`@codemirror/state`, so a consumer's `EditorState.create(...)` typechecked and then failed to
link. PR #173 fixed the instance with a local alias; TYTO-118 adds
`tools/repo-checks/src/declared-value-exports.test.ts`, which compares, for every `exports`
entry with a `types` condition, the values the `.d.ts` promises against the names the `.js`
exports.

That check reads build output, and `@tyto/repo-checks` declared no workspace dependency. In
`turbo.json`, `test` depends on `^build` — the builds of the package's own dependencies — so
for `@tyto/repo-checks#test` it ordered nothing: `dist/` could be absent, or left over from an
older checkout, when the suite ran. A check that skips a package without `dist` reports green
having measured nothing, which is the failure shape of `--passWithNoTests` (TYTO-111) and of
the cache hit that restored nothing (TYTO-15). The question was how the check gets a fresh
`dist`, and it has three answers.

## Decision

**Every package with a `types` entry is a `workspace:*` devDependency of `@tyto/repo-checks`**
— thirteen packages, fourteen entry points (`@tyto/core` has `.` and `./template`). Two things
follow from that one edge, and the check needs both:

- `^build` now orders `@tyto/repo-checks#test` after those thirteen builds. Measured with
  `turbo run test --filter=@tyto/repo-checks --dry=json`: the task depends on the thirteen
  `#build` tasks.
- Turborepo folds a workspace dependency's hash into the dependent task's hash, so a change to
  any of those packages' sources invalidates `@tyto/repo-checks#test`. Without that, a cache hit
  would replay a green result measured against the old `dist`.

Two assertions keep the edge honest. The suite's first test fails when a package declares a
`types` entry and is missing from the devDependencies, so a new package cannot join the
workspace outside the check. And every entry asserts that its `.d.ts` and `.js` exist before
comparing them: a missing file is a red test naming it, never a package skipped.

No cycle: `@tyto/repo-checks` is private and no package depends on it.

The rule is general, not specific to this suite: **a repo-check that reads a workspace
package's build output declares that package as a `workspace:*` devDependency**.

## Alternatives

- **A root script that runs the check after `pnpm build`, outside `turbo test`.** It would
  always see a fresh `dist`, but it sits outside `pnpm check`, so it is outside the `check` job
  and outside the required checks unless `ci.yml` grows a step for it — and then the order is a
  convention in YAML rather than an edge Turborepo enforces. It also gives up the cache: it runs
  in full on every invocation, whatever changed.
- **Let the check build what it needs itself.** Turborepo's hash for `@tyto/repo-checks#test`
  would not cover the packages' sources, so a cache hit would replay a green result measured
  against a `dist` that no longer exists. And in CI the suite's own builds would race the
  `build` tasks Turborepo runs in parallel for `typecheck` and `test`, writing the same `dist/`
  directories from two processes.

## Consequences

- `@tyto/repo-checks#test` now waits for the thirteen builds instead of starting with the first
  wave of tasks. In the `check` job those builds run anyway — `typecheck` and every other `test`
  already depend on `^build` — so the cost is ordering, not work.
- Any change to any of the thirteen packages invalidates `@tyto/repo-checks#test`, so the whole
  repo-checks suite reruns where it used to replay from cache. That is the price of the second
  bullet above, and the reason it was worth paying.
- Adding a package with a `types` entry fails `pnpm check` until it is added to
  `tools/repo-checks/package.json`.
