# Conventions

## Language

English everywhere in the repo: code, comments, docs, commits, PRs, Jira cards (cards also carry a Portuguese translation — see `CLAUDE.md`). User-facing UI strings live in `i18n/` with `pt-BR` as the first locale and `en` as fallback.

## Stack

pnpm workspaces + Turborepo · TS 5 `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` · Zod · Vitest · Playwright · ESLint flat + Prettier · tsup (libs, ESM) · electron-vite · CodeMirror 6 + Lezer · commander · Changesets.

## Root scripts

`pnpm dev` (desktop) · `pnpm cli -- …` · `pnpm check` = typecheck + lint + test · `pnpm test:visual` (raster snapshots) · `pnpm build` · `pnpm changeset` · `pnpm format` / `format:check`.

## Packages

Name `@tyto/<name>`. `src/index.ts` is the only public API. `exports` in package.json. Tests beside the code: `foo.test.ts`. Fixtures in `__fixtures__/`.

## Runtime boundary

Every package is _pure_, _Node_ or _DOM_ (ADR 0010). The category is declared twice on purpose: `tsconfig.{pure,node,dom}.json` decide which types the package can even see, and the `boundary/*` blocks in `eslint.config.js` forbid the matching imports and globals with a message that names the way out. `tools/repo-checks` lints throwaway sources against the real config, so weakening a boundary rule fails `pnpm check`.

## Git

See `docs/git-workflow.md`.

## Tests

- Pure: Vitest unit tests.
- Exporters: `.brief` fixture → committed `.html`/`.svg` snapshot.
- Raster: reference PNG + tolerant diff (`pixelmatch`), runs in CI with Playwright.
- Desktop: Playwright for critical flows (open brief, see preview, export).
- Test fonts bundled in the repo (determinism).

## Errors

`Result<T, Diagnostic[]>` from `@tyto/core`. `Diagnostic { severity, code, message, range?, hint? }`. Codes `E_*`/`W_*` catalogued in `core/src/diagnostics/codes.ts`.

## Docs

An ADR for every decision that affects more than one package: `docs/adr/NNNN-title.md` (Context / Decision / Consequences).
