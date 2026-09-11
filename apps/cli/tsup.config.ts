import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  // Written here rather than at the top of `src/index.ts`, so there is exactly one of it:
  // esbuild keeps a shebang it finds in the entry file, and a banner beside it would
  // produce two.
  banner: { js: '#!/usr/bin/env node' },
});
