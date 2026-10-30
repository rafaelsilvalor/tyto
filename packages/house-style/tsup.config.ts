import { defineConfig } from 'tsup';

export default defineConfig({
  // `table-tokens` is its own entry: it and `tokens` both name TITLE, PAPER and ON_ACCENT, so
  // the root cannot re-export both. `azul` is its own entry for the same reason (TYTO-476).
  entry: {
    index: 'src/index.ts',
    'table-tokens': 'src/table-tokens.ts',
    azul: 'src/azul/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
});
