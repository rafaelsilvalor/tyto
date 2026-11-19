import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.visual.test.ts'],
    // A real browser draws every guide layer and every frame: tens of seconds on a cold cache.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Refuses Google Fonts' hosts, as the unit suites do (ADR 0120).
    setupFiles: ['./vitest.no-google.setup.ts'],
  },
});
