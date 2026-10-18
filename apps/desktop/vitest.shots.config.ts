import { defineConfig } from 'vitest/config';

/**
 * The user manual's pictures of the window (TYTO-315, ADR 0102): `pnpm shots`, on demand.
 *
 * Its own config because it is neither of the other two. `vitest.config.ts` is `pnpm check`,
 * where nothing launches; `vitest.desktop.config.ts` is the app's end-to-end suite, which CI
 * runs on every pull request — and pictures are not a test of the app, cost twenty launches and
 * write into the docs site, so they run when somebody asks for them. The harness is the
 * suite's own: the same binary setup and the same second-launch session.
 */
export default defineConfig({
  test: {
    include: ['e2e/**/*.shots.test.ts'],
    globalSetup: ['e2e/electron-binary.global-setup.ts'],
    setupFiles: ['e2e/not-a-first-launch.setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 300_000,
    // One window at a time: a picture is the window alone, and two Electrons on a
    // maintainer's machine is memory the pictures do not need.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
