import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // `src/test-setup.ts` fills the one hole jsdom leaves that CodeMirror reaches into.
    setupFiles: ['./src/test-setup.ts'],
  },
});
