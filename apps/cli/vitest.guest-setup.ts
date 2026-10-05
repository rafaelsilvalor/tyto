import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'tsup';
import type { TestProject } from 'vitest/node';

import { cliBuild, guestBuild } from './tsup.config.js';

/**
 * Builds the plugin bootstrap once per test run, the same way `pnpm build` does (ADR 0049),
 * and the whole CLI beside it for the tests that start it as a process (TYTO-232).
 *
 * A test cannot start the `.ts` in `src/plugins/`: the child runs under the permission model
 * with read access to the plugin's folder and the bootstrap file only, and a bootstrap that
 * imports `@tyto/plugin-api` out of `node_modules` would be refused before it said hello. So
 * the tests start the bundle, which is also what the CLI ships.
 *
 * The CLI is built here rather than read from `dist/`, because turbo runs a package's tests
 * after its dependencies' builds but not after its own: a `dist/` left by an older build would
 * be what the test measured. It goes under this package's `node_modules/.cache`, not the
 * system temp folder, so that its `@tyto/*` imports resolve from where it sits, and in a
 * `dist/` beside a copy of the manifest, because the CLI reads its version from
 * `../package.json` (`environment.ts`).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const outDir = await mkdtemp(join(tmpdir(), 'tyto-guest-'));
  const cache = fileURLToPath(new URL('./node_modules/.cache/', import.meta.url));
  await mkdir(cache, { recursive: true });
  const cliRoot = await mkdtemp(join(cache, 'tyto-cli-'));
  const cliDir = join(cliRoot, 'dist');
  await copyFile(
    fileURLToPath(new URL('./package.json', import.meta.url)),
    join(cliRoot, 'package.json'),
  );
  const started = performance.now();
  await Promise.all([
    build({ ...guestBuild, outDir, config: false, silent: true }),
    build({ ...cliBuild, outDir: cliDir, config: false, silent: true, clean: false }),
    build({ ...guestBuild, outDir: join(cliDir, 'guest'), config: false, silent: true }),
  ]);
  // Written straight to stdout, so the cost of this setup reaches the CI log too.
  process.stdout.write(
    `vitest.guest-setup: built the guest and the CLI in ${String(Math.round(performance.now() - started))} ms\n`,
  );
  const guest = join(outDir, 'plugin-guest.js');
  project.provide('pluginGuest', guest);
  project.provide('builtCli', join(cliDir, 'index.js'));
  // For the tests that run `tyto render` in process, whose plugins start through the CLI's own
  // launcher (`plugin-process.ts`). The test workers inherit it.
  process.env['TYTO_TEST_PLUGIN_GUEST'] = guest;
  return async () => {
    await rm(outDir, { recursive: true, force: true });
    await rm(cliRoot, { recursive: true, force: true });
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** The bundled plugin bootstrap this run's tests start plugins from. */
    pluginGuest: string;
    /** The CLI, bundled as `pnpm build` bundles it, with its bootstrap in `guest/` beside it. */
    builtCli: string;
  }
}
