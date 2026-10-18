# 0101 — The user manual is a VitePress site in `apps/docs`, in English and Brazilian Portuguese

Status: accepted · 2026-10-18 · TYTO-312 (epic TYTO-311)

## Context

Everything under `docs/` is written for people who work on Tyto: the architecture, the ADRs,
the grammar of the brief, the guides for template and plugin authors. Nothing is written for the
person who installs the app and wants to make a banner. Epic TYTO-311 builds that manual, in the
shape of the Blender and VS Code manuals: a static site with a page tree, a search box, generated
reference pages that a test keeps fresh, and an edition in each language its readers use.

The repository had no static-site tool (0 matches for vitepress, docusaurus, astro, starlight or
mkdocs in `pnpm-lock.yaml` before this card), and the stack in `CLAUDE.md` changes only through an
ADR. The repository's rule is also English everywhere, and Tyto's users are Brazilian: the UI
already ships `pt-BR` as its first locale (`docs/conventions.md`). Rafael decided on 2026-10-18
that the manual has two editions from the first page.

## Decision

**1. The tool is VitePress 1.6.x, pinned to 1.6.4.** It takes Markdown and gives static HTML, and
it has the three things the epic asks for built in: locales with a language switcher, a local
search with an index per locale (MiniSearch, no service to call), and a build that fails on a
dead internal link. 2.0 is an alpha. VitePress 1.6 brings its own Vite 5 and Vue 3; the
workspace's Vite 8 (`apps/desktop`, `packages/editor`) is untouched, because pnpm gives each its
own copy. That is one more Vite in the lockfile, and it is the cost of not waiting for 2.0.

Astro Starlight was weighed and set aside. It does the same three things, with a better
default look, but it is a second build toolchain — Astro, its integrations, its content
collections — for a site of Markdown pages, where VitePress is Vite plus a theme. Nothing in the
epic needs an Astro island.

**2. The site is `apps/docs` (`@tyto/docs`), a composition app.** It is an app, not a package,
because it reads files from other places in the repository (the author guides, the desktop
app's manifest) and nobody imports it. Its scripts are `dev`, `build`, `test`, `typecheck` and
`lint`, so `ci.yml`'s `pnpm turbo typecheck lint test build` builds and tests it with no change
to any workflow. It writes to `apps/docs/dist`, the output `turbo.json` already declares, and
keeps VitePress's cache under its own `node_modules`, which ESLint, Prettier and git already
ignore. Its `turbo.json` names the four files it reads from outside the package as inputs
(ADR 0072), and makes `test` depend on its own `build`, because the search suite reads the
built index. It has no `version` field: the site is not released on its own, and the version
it shows is the app's (decision 5).

**3. Two editions: English at `/`, Brazilian Portuguese at `/pt-BR/`.** This is a deliberate
exception to the English-only rule, and it is the only one: the user manual has a pt-BR edition;
code, comments, contributor docs, ADRs, commits, PRs and cards stay English. English is the
source, so a page is written in English first.

**4. The editions cannot drift apart in structure.** A page that exists in one exists in the
other, and `apps/docs/test/parity.test.ts` fails otherwise. A pt-BR page may lag in wording; it
may never be missing. Both sidebars are built from one list (`apps/docs/src/sections.ts`), so
the navigation cannot differ either.

**5. The header's version is the desktop app's, read from `apps/desktop/package.json`.** The app
is what a reader of the manual installed, and importing the manifest means a release that bumps
it cannot leave the manual naming the one before.

**6. Extend includes the author guides; it does not copy or move them.** The three English pages
under Extend are one line each, `<!--@include: ../../../../docs/<guide>.md-->`, for
`template-authoring.md`, `plugin-authoring.md` and `plugin-api.md`. The guides stay in `docs/`,
where contributors keep them in step with the code in the same pull request, and the site
renders whatever is there at build time. They had 0 relative links between them when this was
decided, so nothing in them points at a file the site does not serve. They are the one
exception to decision 4: English-only, listed in `ENGLISH_ONLY_PAGES`, because they are written
for people who write code — the audience of the English-only rule — and a translation would be a
second copy to keep in step with every change to the first. The pt-BR Extend page says so and
links to the English pages.

**7. Contributor docs stay out of the user site.** `architecture.md`, the ADRs,
`git-workflow.md` and the rest of `docs/` are not pages of the manual.

## Consequences

- A guide under `docs/` that gains a relative link to another file in `docs/` breaks the docs
  build, since the site does not serve that file. That is the dead-link check working; the fix
  is a link to the page in the site, or an absolute link to the repository.
- Prose in an included guide is compiled as a Vue template, so Markdown that passes raw HTML
  through breaks the build. It did once, on the first build: `plugin-authoring.md` wrapped the
  code span `` `--out <dir>` `` so that a line began with `<dir>`, and `dir` is one of the
  block-level tag names CommonMark starts a raw HTML block with. Vue then read an unclosed
  `<dir>` element (`Element is missing end tag`, line 35 of the included page). The fix was to
  rewrap that sentence so the span sits on one line; the include stayed. A `{{` outside code is
  the other construct to avoid.
- `pnpm check` now builds the site, because `test` depends on `build` in `apps/docs`.
- Every later card of the epic adds a page in both editions or the parity suite stops it.
- The site is built on every pull request and published nowhere yet; publishing is TYTO-318.
