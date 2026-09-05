import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each case runs the real ESLint flat config; loading typescript-eslint the first
    // time costs several seconds, which the 5s default mistakes for a hang.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
