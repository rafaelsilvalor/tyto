import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The visual suite needs a browser on disk and half a minute of wall clock, so it is
    // not part of `pnpm check`. `pnpm test:visual` runs it, from its own config, on the
    // paths `visual.yml` filters for.
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.visual.test.ts'],
  },
});
