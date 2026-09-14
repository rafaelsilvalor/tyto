import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The end-to-end suite launches a real Electron — a ~246 MB binary it downloads on
    // first use, and a window — so it is not part of `pnpm check`, the same arrangement
    // `packages/raster` makes for its visual suite. `pnpm test:desktop` runs it from its
    // own config.
    include: ['shared/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
