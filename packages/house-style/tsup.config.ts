import { defineConfig } from 'tsup';

export default defineConfig({
  // `table-tokens` is its own entry: it and `tokens` both name TITLE, PAPER and ON_ACCENT, so
  // the root cannot re-export both.
  entry: ['src/index.ts', 'src/table-tokens.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
});
