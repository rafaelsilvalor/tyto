import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The PNG half needs Playwright's Chromium on disk, which the `pnpm check` job does not
    // install — the same arrangement `packages/raster` makes for its visual suite.
    include: ['src/**/*.visual.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
