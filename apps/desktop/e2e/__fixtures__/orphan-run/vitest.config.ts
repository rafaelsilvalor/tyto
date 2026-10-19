import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * A run whose worker dies with an app open, for `orphan-guard.desktop.test.ts` (TYTO-292).
 *
 * The harness the real suites get, minus the binary download the outer run already did: the
 * same launch wrapper and the same ledger. The one test file is not named `*.test.ts`, so no
 * other config, and not `launch-isolation.test.ts`'s scan, ever picks it up.
 */
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    include: ['orphan.fixture.ts'],
    globalSetup: ['../../launch-ledger.global-setup.ts'],
    setupFiles: ['../../not-a-first-launch.setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
