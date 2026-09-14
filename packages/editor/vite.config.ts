import { defineConfig } from 'vite';

/**
 * Only the demo is built here. The package itself ships through tsup like every other
 * library in the workspace; this config exists so `demo/` has a dev server and a bundle
 * that proves the package resolves for a browser — the second half of E8.1's acceptance.
 *
 * The example briefs it imports live in `@tyto/templates`, outside this root. Vite finds
 * the workspace root from `pnpm-workspace.yaml` and serves within it, so no `fs.allow`
 * entry is needed; a raw import is also how the package reads a `.brief` at all, because
 * a DOM package may not open a file (ADR 0010).
 */
export default defineConfig({
  root: 'demo',
  build: {
    // Beside the demo rather than in the package's `dist/`, which is tsup's output and
    // what `files` publishes.
    outDir: 'dist',
    emptyOutDir: true,
  },
});
