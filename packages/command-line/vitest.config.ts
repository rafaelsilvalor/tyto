import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The visual suite needs a browser on disk, so it is not part of `pnpm check`:
    // `pnpm test:visual` runs it from its own config, as `packages/raster` does.
    exclude: ['**/node_modules/**', 'src/**/*.visual.test.ts'],
    // Builds the plugin bootstrap the confined child processes start from (ADR 0049).
    globalSetup: ['./vitest.guest-setup.ts'],
    // Refuses Google Fonts' hosts in every test file (ADR 0120).
    setupFiles: ['./vitest.no-google.setup.ts'],
  },
});
