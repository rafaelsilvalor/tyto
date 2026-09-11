# CLAUDE.md — Tyto

Read `docs/architecture.md` before any task. Decisions in `docs/adr/` are closed; do not reopen them without a new ADR.

## Language

- Code, identifiers, comments, docs, commit messages, PR titles/bodies, Jira cards: **English**.
- The maintainer (Rafael) reads English fine but writes in **Portuguese**. He will talk to you in Portuguese; reply in Portuguese in chat. Everything you _produce_ in the repo stays in English — code, docs, commits, PRs. Quoting English code or docs to him needs no translation.
- Jira cards: title and body in English, followed by a `---` and a Portuguese half. That half is **not a translation** — he reads English fine, so translating the technical body twice buys nothing. It explains, for somebody who does not write code, **what the card adds to Tyto**: one concrete example of what a person can do afterwards that they could not do before, and one sentence on what still does not work. Three sentences to a short paragraph.
- Cards written before 2026-09-11 carry a compressed Portuguese translation instead. They are not retrofitted on sight: a closed card is history, and an open one gets the new half when somebody picks it up.

## What this is

Compiler: brief → Scene IR → exporters (HTML→raster, SVG), plus an Electron app, a CLI and a plugin system. See `README.md`.

## Hard rules

- `packages/core`, `brief-lang`, `template-lang`, `export-*`, `templates`: **no Node or DOM imports**. Pure TS, any runtime. This is what makes the cloud possible later. Enforced by lint.
- No exceptions for expected errors. Stages return `Result<T, Diagnostic[]>`. Diagnostics carry a source `range`.
- Exporters never receive an AST or a brief — only `Scene`. If something must appear in the output, it enters the IR first.
- Every adapter (fs, chromium, http…) implements a port from `core` or `plugin-api`. No package imports another package's adapter; composition happens in `apps/*` only.
- Built-in is a plugin. If a feature does not fit an existing extension point, extend `plugin-api`; do not bypass it.
- Electron: `contextIsolation: true`, `nodeIntegration: false`, typed preload only. Credentials only through `safeStorage`.
- Tyto never knows about Jira, Drive, OAuth or machine identity (ADR 0011).

## Workflow

1. Take the highest-priority TYTO card in To Do (Jira). Read the spec it references in `docs/`.
2. Branch `feat/TYTO-123-slug` (or `fix/`, `chore/`, `docs/`).
3. Implement with tests (Vitest). Exporters require fixture + snapshot (`__fixtures__/*.brief` → `*.html`/`*.svg`; raster uses PNG diff with tolerance).
4. `pnpm check` (typecheck + lint + test) must pass.
5. Conventional Commit with the key: `feat(core): TYTO-123 add Frame schema`.
6. If the task changed a decision or created a convention, update the doc or add an ADR in the same PR.
7. Open a **draft** PR, move the card to Review. Never move to Done and never merge — the human does.

## Stack (do not change without an ADR)

pnpm workspaces + Turborepo · TypeScript strict · Zod · Vitest · Playwright · ESLint flat + Prettier · tsup (libs) · electron-vite (desktop) · CodeMirror 6 + Lezer · commander (CLI) · Changesets.

## Style

No cryptic abbreviations. Small functions, explicit types at package boundaries. Comments explain _why_, not _what_.
