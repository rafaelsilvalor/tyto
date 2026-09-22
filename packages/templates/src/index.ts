import { build as agendaSemana } from '../templates/agenda-semana/template.js';

import type { TemplateBuild } from '@tyto/core';

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
export const BUILT_IN_TEMPLATE_NAMES: readonly string[] = [
  'agenda-semana',
  'carrossel-lista',
  'promo-curso',
];

/**
 * The build functions this pack ships, by the manifest name each one draws.
 *
 * ADR 0005's other route. A template here is **code compiled into the application**, not a
 * file discovered in a folder: the manifest still lives in `templates/<name>/manifest.yaml`
 * and is read without executing anything, and only whoever renders pairs the two. Nothing
 * imports a path — running code that arrived in a folder is the plugin host's job, with
 * its permissions and its isolation (ADR 0007).
 *
 * `agenda-semana` is the first entry (TYTO-167). Its manifest sits beside the other two in
 * `templates/agenda-semana/`, next to the code that draws it, so a designer opening the
 * folder finds the whole template; what makes it *bundled* is this import, which puts the
 * build function in the application's own module graph rather than on a path somebody
 * resolves at runtime.
 */
export const BUILT_IN_TEMPLATE_BUILDS: Readonly<Record<string, TemplateBuild>> = {
  'agenda-semana': agendaSemana,
};
