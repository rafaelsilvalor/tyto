import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.desktop.test.ts'],
    // Launching Electron is seconds, not milliseconds, and the first run on a machine also
    // downloads the binary. The 5s default would read that as a hang.
    testTimeout: 120_000,
    hookTimeout: 300_000,
    // One app, one window. Parallel files would each launch their own Electron for no gain.
    fileParallelism: false,
  },
});
