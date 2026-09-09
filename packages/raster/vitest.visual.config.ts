import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.visual.test.ts'],
    // Launching Chromium and rendering the corpus is tens of seconds on a cold cache,
    // which the 5s default mistakes for a hang. The browser is launched once in a
    // `beforeAll`, hence the wider hook timeout.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One browser, one corpus, one set of reference files on disk. Parallel files would
    // each launch their own Chromium for no gain.
    fileParallelism: false,
  },
});
