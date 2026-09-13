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
 * This package is pure (ADR 0010): no `node:fs`, and a `?raw` import is resolved by a
 * bundler in tests and by nothing in `dist`. So it does not read them, and it does not
 * locate them either. **A pack is a directory, and the composition root finds it**
 * (ADR 0020): `apps/cli` resolves this package's own `package.json` through Node's
 * resolver and joins {@link BUILT_IN_TEMPLATES_DIRECTORY} onto its folder.
 *
 * What this module owns is the one string that is nobody else's business: the name of the
 * subfolder. Exporting it keeps the folder's name in the package that has the folder,
 * rather than hardcoded in whatever resolves it.
 *
 * `tools/contract-test/src/built-in-templates.test.ts` is what keeps the templates honest,
 * and it now drives them twice — once as a `--templates <dir>` folder and once as the
 * registered pack — so the two paths are checked to agree rather than assumed to.
 */

/**
 * The subfolder of this package that holds one folder per template.
 *
 * Relative to the package root, which is where `package.json` is, which is the file Node's
 * resolver can find from outside. `join(dirname(require.resolve('@tyto/templates/package.json')),
 * BUILT_IN_TEMPLATES_DIRECTORY)` is the whole of how the pack is located.
 */
export const BUILT_IN_TEMPLATES_DIRECTORY = 'templates';

/** The names this pack ships, for a caller that wants them without reading a disk. */
export const BUILT_IN_TEMPLATE_NAMES: readonly string[] = ['carrossel-lista', 'promo-curso'];
