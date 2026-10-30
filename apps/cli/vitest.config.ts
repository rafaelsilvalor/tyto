import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Builds the CLI the process tests start (TYTO-232).
    globalSetup: ['./vitest.cli-setup.ts'],
  },
});
