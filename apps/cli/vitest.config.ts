import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Builds the plugin bootstrap the confined child processes start from (ADR 0049).
    globalSetup: ['./vitest.guest-setup.ts'],
  },
});
