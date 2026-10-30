import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'tsup';
import type { TestProject } from 'vitest/node';

import { cliBuild } from './tsup.config.js';

/**
 * Builds the CLI once per test run, for the tests that start it as a process (TYTO-232).
 *
 * Built here rather than read from `dist/`, because turbo runs a package's tests after its
 * dependencies' builds but not after its own: a `dist/` left by an older build would be what
 * the test measured. It goes under this package's `node_modules/.cache`, not the system temp
 * folder, so that its `@tyto/*` imports resolve from where it sits (the plugin bootstrap is
 * `@tyto/command-line`'s, built with it), and in a `dist/` beside a copy of the manifest,
 * because the CLI reads its version from `../package.json` (`environment.ts`).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const cache = fileURLToPath(new URL('./node_modules/.cache/', import.meta.url));
  await mkdir(cache, { recursive: true });
  const cliRoot = await mkdtemp(join(cache, 'tyto-cli-'));
  const cliDir = join(cliRoot, 'dist');
  await copyFile(
    fileURLToPath(new URL('./package.json', import.meta.url)),
    join(cliRoot, 'package.json'),
  );
  const started = performance.now();
  await build({ ...cliBuild, outDir: cliDir, config: false, silent: true, clean: false });
  // Written straight to stdout, so the cost of this setup reaches the CI log too.
  process.stdout.write(
    `vitest.cli-setup: built the CLI in ${String(Math.round(performance.now() - started))} ms\n`,
  );
  project.provide('builtCli', join(cliDir, 'index.js'));
  return async () => {
    await rm(cliRoot, { recursive: true, force: true });
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** The CLI, bundled as `pnpm build` bundles it. */
    builtCli: string;
  }
}
