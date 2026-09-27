import { defineConfig } from 'tsup';

export default defineConfig({
  // Two bundles: the CLI, and the file each installed plugin's worker thread starts from,
  // which a worker can only be given as a file of its own (ADR 0041).
  entry: { index: 'src/index.ts', 'plugin-worker': 'src/plugins/plugin-worker.ts' },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  // Written here rather than at the top of `src/index.ts`, so there is exactly one of it:
  // esbuild keeps a shebang it finds in the entry file, and a banner beside it would
  // produce two.
  banner: { js: '#!/usr/bin/env node' },
});
