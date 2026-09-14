import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.package.test.ts'],
    // Its own config and its own filename suffix, so `test:desktop` does not pick this up.
    // The two suites answer different questions and cost different amounts: that one
    // launches the app this repository has on disk in seconds, this one packages it first.
    //
    // The hook budget is what `electron-builder --dir` needs on a machine that has never run
    // it: a ~100 MB Electron zip, then the pack itself. 23 s once both are cached.
    testTimeout: 120_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
