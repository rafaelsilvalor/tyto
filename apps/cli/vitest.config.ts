import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Builds the plugin bootstrap the confined child processes start from (ADR 0049).
    globalSetup: ['./vitest.guest-setup.ts'],
    // Refuses Google Fonts' hosts in every test file (ADR 0120).
    setupFiles: ['./vitest.no-google.setup.ts'],
  },
});
