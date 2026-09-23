import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the pieces this tool drives live in the monorepo.
 *
 * The tool runs from the repository and nowhere else, so these are fixed paths rather than
 * options: the binary is the one `pnpm build` wrote, and the pack is the one that binary
 * imports.
 */

export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The built CLI. Spawned, never imported: the picture must be `tyto render`'s own. */
export const TYTO_BINARY = join(REPOSITORY_ROOT, 'apps', 'cli', 'dist', 'index.js');

const require = createRequire(import.meta.url);

/**
 * `@tyto/templates`' package folder, resolved the way the CLI resolves it.
 *
 * Its `dist/index.js` is what `BUILT_IN_TEMPLATE_BUILDS` is read from, so it is the one
 * thing a saved `template.ts` has to reach before a render can show it.
 */
export const TEMPLATES_PACKAGE = dirname(require.resolve('@tyto/templates/package.json'));

/** The built-in pack's folder of template subfolders, and its `formats.yaml`. */
export const BUILT_IN_PACK = join(TEMPLATES_PACKAGE, 'templates');
export const BUILT_IN_FORMATS = join(BUILT_IN_PACK, 'formats.yaml');

/** The script that rebuilds `@tyto/templates`, run with that package as its working folder. */
export const REBUILD_SCRIPT = fileURLToPath(new URL('./rebuild-templates.ts', import.meta.url));
