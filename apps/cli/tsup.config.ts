import { type Options, defineConfig } from 'tsup';

/**
 * The CLI itself: the terminal's environment around `@tyto/command-line` (ADR 0159). Exported
 * for `vitest.cli-setup.ts`, which builds it for the process tests. The plugin bootstrap is the
 * command tree's, built in that package beside the launcher that starts it.
 */
export const cliBuild: Options = {
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  // Written here rather than at the top of `src/index.ts`, so there is exactly one of it:
  // esbuild keeps a shebang it finds in the entry file, and a banner beside it would
  // produce two.
  banner: { js: '#!/usr/bin/env node' },
};

export default defineConfig([cliBuild]);
