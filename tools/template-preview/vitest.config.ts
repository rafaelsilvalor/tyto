import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.visual.test.ts'],
    // Every case spawns the built `tyto` binary at least once, and a cold Node start plus a
    // template registry read is a few seconds on a loaded machine.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
