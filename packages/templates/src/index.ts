/**
 * @tyto/templates — the built-in template pack.
 *
 * Ships through the same plugin extension point third-party packs use; being built in
 * buys it no shortcuts.
 *
 * ## The templates are files, and this module does not read them
 *
 * `promo-curso` and `carrossel-lista` live under `templates/` beside this folder, as the
 * manifest-plus-markup folders `docs/template-authoring.md` describes — the same shape a
 * designer writes by hand, checked by the same `tyto template check`. They are in the
 * package's `files`, so they publish with it.
 *
 * This package is pure (ADR 0010), so it cannot read them: no `node:fs`, and a `?raw`
 * import is resolved by a bundler in tests and by nothing in `dist`. **Registering the
 * pack is therefore still open** (TYTO-25 delivered the folders and deferred the wiring):
 * somebody has to decide how a published package's directory is located at runtime and how
 * a built-in pack merges with `--templates <dir>` when both offer the same name. That is a
 * decision across `templates`, `cli` and `pipeline`, which means an ADR rather than a
 * default chosen here.
 *
 * Until then the folders are usable directly:
 *
 * ```
 * tyto render brief.brief --templates node_modules/@tyto/templates/templates
 * ```
 *
 * `tools/contract-test/src/built-in-templates.test.ts` is what keeps them honest.
 */
export {};
