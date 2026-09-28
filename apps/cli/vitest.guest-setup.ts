import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build } from 'tsup';
import type { TestProject } from 'vitest/node';

import { guestBuild } from './tsup.config.js';

/**
 * Builds the plugin bootstrap once per test run, the same way `pnpm build` does (ADR 0049).
 *
 * A test cannot start the `.ts` in `src/plugins/`: the child runs under the permission model
 * with read access to the plugin's folder and the bootstrap file only, and a bootstrap that
 * imports `@tyto/plugin-api` out of `node_modules` would be refused before it said hello. So
 * the tests start the bundle, which is also what the CLI ships.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const outDir = await mkdtemp(join(tmpdir(), 'tyto-guest-'));
  await build({
    ...guestBuild,
    outDir,
    config: false,
    silent: true,
  });
  const guest = join(outDir, 'plugin-guest.js');
  project.provide('pluginGuest', guest);
  // For the tests that run `tyto render` in process, whose plugins start through the CLI's own
  // launcher (`plugin-process.ts`). The test workers inherit it.
  process.env['TYTO_TEST_PLUGIN_GUEST'] = guest;
  return () => rm(outDir, { recursive: true, force: true });
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** The bundled plugin bootstrap this run's tests start plugins from. */
    pluginGuest: string;
  }
}
