import { defineConfig } from 'tsup';

export default defineConfig({
  // Named entries: two `index.ts` files would both want to be `dist/index.js`.
  entry: { index: 'src/index.ts', template: 'src/template/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
});
