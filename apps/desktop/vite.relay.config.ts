import { resolve } from 'node:path';

import { defineConfig } from 'vite';

/**
 * The relay an agent in a Tyto terminal starts to reach the window (TYTO-567, ADR 0181), as one
 * self-contained file the bundled Node runs, built the way the plugin bootstrap is
 * (`vite.guest.config.ts`): every dependency inlined, Node's own modules left to Node, into
 * `out/relay/`, which `electron-builder.yml` unpacks from the asar.
 */
export default defineConfig({
  build: {
    ssr: resolve(import.meta.dirname, 'src/main/agent-relay.ts'),
    outDir: 'out/relay',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      // The relay imports the exit codes from `@tyto/command-line`, which reads them from
      // `@tyto/io`, whose `@tyto/pipeline` reaches `@tyto/raster` and Playwright. None of it is
      // used and all of it is shaken out, but Rolldown resolves Playwright's imports first, and
      // one of them is not installed. Left external, it is never resolved; the bundle imports
      // nothing but Node's own modules, which `terminal-agent.desktop.test.ts` reads in the built file.
      external: [/^playwright/u, /^chromium-bidi/u],
      output: { format: 'es', entryFileNames: 'agent-relay.js', inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: true, target: 'node' },
});
