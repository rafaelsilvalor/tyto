# Backlog → Jira (project TYTO)

Epics in dependency order. Each story becomes a card with: referenced spec, acceptance criteria (AC), package(s). Card body in English followed by a Portuguese translation. Size S/M/L is for ordering only.

## E1 — Monorepo foundation

Spec: `docs/conventions.md`, `docs/git-workflow.md`, ADR 0010, 0012.

- **E1.1** pnpm + Turborepo monorepo with empty packages, base tsconfig, ESLint flat (pure/Node/DOM boundary rule), Prettier, Vitest, Husky/lint-staged/commitlint, Changesets. AC: `pnpm check` green; importing `node:fs` inside `core` fails lint. (M)
- **E1.2** `@tyto/core` — `Result`, `Diagnostic`, code catalog, range helpers. AC: tests; generated code doc. (S)
- **E1.3** GitHub: `ci`, `visual`, `commitlint`, `release` workflows; branch protection; Dependabot; Git LFS for snapshots; PR template. AC: a PR with broken lint is blocked; Changesets opens the version PR. (M)
- **E1.4** `desktop.yml` workflow (OS matrix + electron-builder + GitHub Release). Enters once E9.1 exists. (S)
- **E1.5** Changeset reminder in the pre-commit hook: warns, never blocks, when a commit touches a publishable package while the branch has no changeset. AC: warns on `packages/*` without one; silent with one, and silent for private packages. (S)
- **E1.6** Turborepo remote cache. Deferred on measurement — a cold `ci` run is 19s today. Enters after E5.3, when Playwright and electron-builder make it hurt. (S)

## E2 — Scene IR

Spec: `docs/ir-schema.md`, ADR 0003.

- **E2.1** Full Zod schema + inferred types + invariants (unique ids, valid mask, referenced fonts/assets). AC: valid and invalid fixtures covering every invariant. (M)
- **E2.2** `SceneVisitor<T>` and `walk()` with context (accumulated transform, effective opacity). AC: counting visitor tested. (S)
- **E2.3** Template-SDK builders `frame/group/text/image/rect/vector`. AC: build valid IR; typed error on misuse. (S)
- **E2.4** How a line break reaches the Scene. Settled by ADR 0016: `TextRun` is a tagged union of `TextSpan` and `LineBreak`, so no exporter scans a string for a break. (M)

## E3 — Brief language

Spec: `docs/brief-language.md`, ADR 0004.

- **E3.1** Lezer grammar (frontmatter, directives, adjustments, inline Markdown, comments, escapes). AC: a 20-brief corpus parses; syntax errors yield Diagnostics with range. (L)
- **E3.2** Parser → typed `BriefAst`. AC: AST snapshot per fixture. (S)
- **E3.3** `resolve`: AST × manifest → `ResolvedBrief` with every E_/W_ from the doc. AC: one test per diagnostic code. (M)

## E4 — Templates

Spec: `docs/template-authoring.md`, ADR 0005.

- **E4.1** Zod schema for `manifest.yaml` + `TemplateRegistry` (folder discovery, no execution). AC: invalid manifest reported with path. (S)
- **E4.2** `compile`: ResolvedBrief × template.ts → Scene (artworks per repeat, frames per format, adjustments). AC: promo-curso fixture in TS yields a valid Scene. (M)
- **E4.3** `@tyto/template-lang`: parser for the HTML-like markup (tags, attributes, restricted CSS, `@format`, `@if`, `@each`, `extends`) → template function. AC: promo-curso in HTML yields a Scene identical to the TS version. (L)
- **E4.4** Two built-in templates (promo-curso, carrossel-lista) with example `.brief` files. AC: render in feed and story without overflow. (M)
- **E4.5** Text auto-fit (`overflow: shrink`) with font measurement in `core` (fontkit/opentype.js). AC: W_TEXT_OVERFLOW accurate to ±1px vs raster. (M)
- **E4.6** `formats.yaml`: the project's format catalogue (id to size), read by `compile` and handed to a template as `context.size`. Blocks E4.3. AC: invalid file reported with the YAML path and a range; a template rendering an undefined format is a diagnostic. (S)
- **E4.7** Three loose ends from E3.3 and E4.1. Opened straight on the board as TYTO-57 and
  never written here; this line exists so the gap in the numbering is not read as a typo. (S)
- **E4.8** A slot used only in the stylesheet is not unused. Opened straight on the board as
  TYTO-63 and never written here; this line exists so the gap in the numbering is not read
  as a typo. (S)
- **E4.9** Reusable components in the template markup: `<define name="…">` at the top level
  and `<use component="…">` wherever a node may appear, expanded before the tree reaches
  `build.ts`. A `<use>`'s own classes propagate to every node in the expansion, the way a
  flag adjustment already does (`.chip.second`), which is what gives an instance an
  override without a descendant combinator or a second cascade — both of which the
  language closed on purpose (`docs/template-authoring.md`, ADR 0017). `<define>` may not
  write `id`, so masks stay out of a component and the existing "id used twice in one
  frame" check keeps meaning what it means. Needs an ADR in the same PR. AC: three `<use>`
  of one `<define>` produce the scene the hand-written triplicate produces; a circular
  `<use>`, an unknown component and an `id` inside a `<define>` are each refused with a
  suggestion. (M)
- **E4.10** Component parameters: `<define name="card" params="texto">` with the body
  writing `slot="texto"`, bound by `<use component="card" texto="slide">`. Substitution
  happens before `checkSlot`, so the existing slot type-checking and `renderedSlots` are
  unchanged. Without it a component only repeats shapes; with it, content. (M)
- **E4.11** Register the built-in template pack, and say how it merges with `--templates`.
  Opened straight on the board as TYTO-66 and never written here; this line exists so the
  gap in the numbering is not read as a typo. (M)

**What E4.9 is not, and what it costs.** Measured against the parser as it shipped in
TYTO-24, not estimated:

- **The grammar needs no change.** `TagName`, `AttributeName` and `AtKeyword` are generic
  identifiers, so `<define>`, `<use>` and `@component` already parse; what refuses them is
  `isTag` in `vocabulary.ts` and the top-level check in `collectFrames`.
- **The IR contract does not change.** Expansion happens above the `switch (element.tag)`
  in `build.ts`, so the IR receives a `group` indistinguishable from a hand-written one.
- **Instances do not collide by id.** `assignIds` derives an id from position, so two
  copies of a subtree get `…0.0` and `…1.0` on their own. Only an explicit `id` collides,
  and that case is already refused with a range.
- **Components do not give data-driven repetition.** A repeatable slot produces one artwork
  per occurrence, so a `<use>` is always written by hand. This is a DRY feature for a
  template author, not a loop; a grid whose column count depends on the data is still a
  `template.ts`.

**Gate: E4.4 first.** There are no real templates yet, so how much duplication the markup
actually produces is unmeasured. `promo-curso` and `carrossel-lista` are the evidence, and
designing the syntax before they exist is the mistake ADR 0017 avoided by shipping only
what the parser could not be written without.

A shared component library across templates — a `component-pack` extension point, with the
CSS scoping it would force — is deliberately absent. That is where a component's style can
collide with its host's, and it has no consumer: `packages/templates` ships no template
yet.

## E5 — Exporters and raster

Spec: `docs/ir-schema.md` (mapping table), ADR 0002.

- **E5.1** `export-html`: full visitor incl. blend, mask, clip, effects, bundled `@font-face`. AC: HTML snapshots per fixture. (L)
- **E5.2** `export-svg`: full visitor incl. `<mask>`, `<clipPath>`, `<filter>`, embedded fonts or text→path (flag). AC: snapshots; SVG opens in Figma and Illustrator without errors. (L)
- **E5.3** `raster` port + Playwright adapter; alpha via `omitBackground`; JPG/WebP with quality. AC: reference PNG per fixture with diff ≤ 0.1%. (M)
- **E5.4** Chromium adapter via offscreen BrowserWindow (desktop). AC: same output as Playwright within tolerance. (S)

## E6 — Pipeline and CLI

Spec: `docs/architecture.md`, `docs/integrations.md`, ADR 0011.

- **E6.1** `pipeline`: Job brief→artifacts, progress, cancellation, file naming `<artwork>-<format>.<ext>`. AC: a 3-slide × 2-format job yields 12 files (png+svg). (M)
- **E6.2** `io`: BriefSource/OutputSink ports + fs-inbox/fs-outbox adapters. AC: a folder in inbox becomes a folder in outbox with `result.json`. (S)
- **E6.3** CLI `tyto render` (ADR 0011 contract: `--out`, `result.json`, exit 0/1/2), `watch`, `template check`, `template new`. AC: complete `--help`; `result.json` validated by schema; readable diagnostics output. (M)

## E7 — Plugin host

Spec: `docs/plugin-api.md`, ADR 0007.

- **E7.1** Extension-point types + in-process `PluginHost` (no isolation yet). AC: exporters, rasterizer, template-pack and fs source/sink registered as built-in plugins; nothing else is imported directly. (M)
- **E7.2** `tyto-plugin.json` schema + `plugin list`. AC: built-ins listed with their contributes. (S)

## E8 — Editor

Spec: ADR 0006, `docs/brief-language.md`.

- **E8.1** `@tyto/editor`: CodeMirror 6 with the brief language (Lezer from E3.1), highlighting, folding. AC: standalone HTML demo. (M)
- **E8.2** Inline diagnostics (lint gutter) from resolve; slot/adjustment autocomplete from the manifest. AC: error appears <200 ms after typing. (M)
- **E8.3** Vim mode (`@replit/codemirror-vim`) toggle; Command pattern with undo/redo; registrable keymap. AC: `:w` triggers the save command. (M)
- **E8.4** template-lang in the editor (highlighting + diagnostics). AC: demo. (S)

## E9 — Desktop

Spec: ADR 0001, `docs/architecture.md` (processes).

- **E9.1** electron-vite scaffold, typed preload, IPC contracts, `safeStorage`, i18n scaffold (pt-BR first). AC: app opens; renderer has no Node. (M)
- **E9.2** Main screen: editor + live per-format preview (debounced, rendered by the pipeline in main). AC: editing the brief updates the preview <1 s for 1080² formats. (L)
- **E9.3** Diagnostics panel, template picker, artwork (slide) list. AC: clicking a diagnostic positions the cursor. (M)
- **E9.4** Export (folder, formats, types) and open folder. AC: PNG+SVG in the chosen folder. (S)
- **E9.5** "Edit template" mode with preview across all manifest formats. AC: saving a template recompiles open briefs. (M)
- **E9.6** Local queue panel: reads `inbox/`, shows jobs, status, retry, opens `out/`. AC: a folder created by Jacurutu (or by hand) appears and renders. (M)

## E10 — Remote integrations (DEFERRED — ADR 0011)

Covered by Jacurutu through the file contract. Activate only if Jacurutu does not cover it.

- **E10.0** `tyto render` + `result.json` + exit-code contract documented and tested (part of E6.3). (S)
- E10.1–E10.5 (scheduler, Jira source, Drive sink, Trello/Notion/Sheets, config UI) — frozen. Spec preserved in `docs/integrations.md`.

## E11 — External plugins

Spec: `docs/plugin-api.md`.

- **E11.1** Loader for `~/.tyto/plugins`, `plugin install|remove|disable`, manifest and permission validation. (M)
- **E11.2** Isolation in utilityProcess/worker with typed RPC; host as proxy; permission-filtered `fetch`. (L)
- **E11.3** `panel` in a sandboxed iframe and plugin `directive`s. (M)
- **E11.4** Example published plugin (template pack) + `docs/plugin-authoring.md`. (S)

## E12 — Cloud (future, do not estimate)

`pipeline` worker in a container with Playwright; sources/sinks over HTTP; remote queue; database via adapter. No cards yet.

---

Suggested execution order: E1 → E2 → E3 → E4.1–4.2 → E5 → E6 → E7 → E4.3–4.5 → E8 → E9 → E11. E10 only if needed. After E6.3 there is a usable CLI product.
