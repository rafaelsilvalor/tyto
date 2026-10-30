# 0152 — A template's repository tests through the kit's testing entry

Status: accepted · 2026-10-28 · TYTO-447 · builds on ADR 0010, ADR 0047, ADR 0149, ADR 0150 and ADR 0151

## Context

E18 (TYTO-429) moves each production template into a repository of its own, and ADR 0151 §8
says that repository tests itself without a Tyto checkout. ADR 0150 gave a plugin's repository
`@tyto/plugin-api/testing`, which runs a plugin's registrations and recipe verbs. It does not
compile a brief: a template's fixture + snapshot test needs `parseBrief`, `resolve`, `compile`
and the HTML exporter, and `@tyto/brief-lang` and `@tyto/export-html` were not in the published
contract (ADR 0150, Consequences).

Read in the code at `origin/main` 6e3d05f5:

- **No helper composes the four stages.** `apps/desktop/src/main/preview.ts` and the CLI each
  compose them, with Node adapters around them — the template folder, the font folders, the
  source cache. Every stage itself is pure.
- **`compile` requires a `FormatCatalogue`** (`CompileOptions.formats`, no default), because a
  template states its layout and not its canvas. The one catalogue in the repository is
  `packages/templates/templates/formats.yaml`, the house's sizes, in a package that is not
  published.
- **`@tyto/export-html` depends on `@tyto/plugin-api`** (its `Plugin` export), so a helper in
  `@tyto/plugin-api/testing` that imports the exporter would be a dependency cycle.
- **The exporter treats a face nobody resolved as fatal**, and `compile` without a `FaceCache`
  measures nothing and keeps the lines a template produced.

## Decision

1. **`@tyto/template-kit/testing` is a second entry of the kit**, with one function,
   `compileTemplate({ brief, template, formats, ... })`. It runs `parseBrief` → `resolve` →
   `compile` → `exportHtml` in the preview's order, over an in-memory registry holding the one
   template, and answers `Result<{ scene, frames }, Diagnostics>`: the `Scene` and one HTML
   document per frame (artwork, format, size, html), with every stage's warnings on the ok
   branch, or every diagnostic that stopped it. A brief whose frontmatter names no template is
   compiled against the one under test; a brief that names another is `E_UNKNOWN_TEMPLATE`, as
   in the app. It lives in the kit and not in `plugin-api/testing` because of the cycle above,
   and because a template's repository already depends on the kit.
2. **The template is a core `Template`**, `defineTemplate(manifest, build, files?)` — a code
   template, which is what production templates are written as (ADR 0151). A markup template
   would need `@tyto/template-lang` and a folder reader; it is not covered.
3. **The caller passes the formats.** The kit ships no catalogue of sizes: a canvas is a
   brand's choice, and ADR 0047 keeps brand decisions out of the kit — a kit that shipped the
   house's `formats.yaml` "would be deciding somebody else's brand". A template's repository
   declares the formats it renders, with `formatCatalogue` or `parseFormats` from `@tyto/core`.
4. **By default nothing is measured and every face is a placeholder.** No `FaceCache`, so text
   keeps the template's own lines; and a `font` resolver that answers
   `tyto-test-font:<family>-<weight>-<style>` instead of a font file's bytes, so the exporter
   does not refuse the document and no base64 font lands in a snapshot. **Those snapshots
   differ from a real export by design**: they change when the template does, not when a
   machine has another font. A caller passes `faces`, `font`, `assets`, `asset` and
   `brandKits` for the real layout and bytes. Fonts stay behind the caller's resolver;
   `@tyto/fonts` is Node and is not published.
5. **The contract grows by `@tyto/brief-lang` and `@tyto/export-html`**, both pure and versioned.
   `@tyto/template-kit` depends on them, and `CONTRACT_PACKAGES` is core, recipe, plugin-api,
   brief-lang, export-html, template-kit — dependencies first, held by
   `publish-contract.test.mjs`. The house's package, `@tyto/house-style` (TYTO-431), goes after
   the kit.

## Consequences

- The TYTO-434 pilot runs its fixture + snapshot tests in its own repository, installing the
  published contract. A change to its template's HTML fails its snapshot there.
- Every template repository installs `@tyto/brief-lang` and `@tyto/export-html` with the kit,
  including the Lezer runtime and `yaml`. They are small and pure, and a separate testing
  package would be a seventh published name for two imports.
- A release that changes either package now publishes it. A breaking change to the exporter's
  HTML is a snapshot change in every template repository that moves its range — which is what
  the snapshot is for.
- The PNG is not covered: rasterizing needs Chromium, which stays the app's and the CLI's.

## Rejected

- **The helper in `@tyto/plugin-api/testing`.** `@tyto/export-html` depends on
  `@tyto/plugin-api`; the helper there would make the contract a cycle.
- **A default catalogue in the kit**, copied from `@tyto/templates`. It is the house's sizes;
  see 3.
- **Real faces by default.** It needs `@tyto/fonts`, which is Node, and it ties a snapshot to
  the fonts a machine has — the CI has no CircularXX.
- **A package of its own, `@tyto/template-testing`.** It is nothing but the contract composed,
  as ADR 0150 said of the plugin harness, and it versions with the kit it tests.

## Amendment — 2026-10-30 · TYTO-454

**A markup template is covered too; decision 2 no longer stands alone.** `compileTemplate`
takes `template: Template | MarkupTemplate`, where a `MarkupTemplate` is
`{ markup, manifest, assets? }`: the text of `template.html`, the parsed manifest and the
`svg`/`image` resolvers for the files its `src=` names. The field `markup` tells the two apart;
a code `Template` never has one. The test reads the files and hands them in, so the kit still
reads no folder (ADR 0010), which is what decision 2 meant by "a folder reader".

The markup is compiled with `@tyto/template-lang`'s `compileTemplate`, as the app's render job
compiles it; its diagnostics stop the run before the brief is read, and its `renderedSlots`
reach `resolve`, so a brief that fills a slot the markup never reads gets `W_UNUSED_SLOT` in
the test as in the app.

**The contract grows by `@tyto/template-lang`** (decision 5). Its closure is `@tyto/core` and
the Lezer runtime (`@lezer/common`, `@lezer/highlight`, `@lezer/lr`, public on npm); it is pure
and already checked as such by `pure-export-conditions.test.ts`. `CONTRACT_PACKAGES` is now
core, recipe, plugin-api, brief-lang, template-lang, export-html, template-kit, house-style.
Every template repository installs it with the kit, code templates included — one more small
pure package, against a second testing entry for one import.
