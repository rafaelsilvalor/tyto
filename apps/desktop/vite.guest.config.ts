import { resolve } from 'node:path';

import { defineConfig } from 'vite';

/**
 * The bootstrap an installed plugin's process starts from, as one self-contained file
 * (TYTO-186, ADR 0050).
 *
 * Not one of electron-vite's three builds. Its `main` build shares a chunk between
 * `index.js` and every other entry, and the plugin's process runs on the bundled Node under
 * `--permission` with read access to its plugin's folder and to this one file. A chunk beside
 * it would have to be granted too, and it is the app's own code. So this is built on its own,
 * with every dependency inlined and Node's own modules left to Node, into `out/guest/`, which
 * `electron-builder.yml` unpacks from the asar: the bundled Node is not Electron and cannot
 * read inside one.
 */
export default defineConfig({
  build: {
    ssr: resolve(import.meta.dirname, 'src/main/plugin-guest.ts'),
    outDir: 'out/guest',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      output: { format: 'es', entryFileNames: 'plugin-guest.js', inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: true, target: 'node' },
});
