import { type Options, defineConfig } from 'tsup';

/**
 * The bootstrap an installed plugin's process starts from (ADR 0049), as its own build.
 *
 * **Everything it imports is inlined.** The process is started under Node's permission model
 * with read access to the plugin's folder and to this one file, so a `@tyto/plugin-api` left
 * external would be a read of `node_modules` the model refuses. Exported for
 * `vitest.guest-setup.ts`, which builds the same file for the tests.
 */
export const guestBuild: Options = {
  entry: { 'plugin-guest': 'src/plugins/plugin-guest.ts' },
  outDir: 'dist/guest',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  noExternal: [/.*/u],
  // `yaml`, inlined through `@tyto/core`, is CommonJS and calls `require('process')`, which an
  // ESM bundle does not have: esbuild's shim throws "Dynamic require of process is not
  // supported" at the first line. Only Node's own modules are left for it to require.
  banner: {
    js: "import { createRequire as tytoCreateRequire } from 'node:module'; const require = tytoCreateRequire(import.meta.url);",
  },
  dts: false,
  sourcemap: false,
  clean: true,
};

/**
 * The command tree. One entry and no chunks: `launchPluginProcess` finds the bootstrap at
 * `./guest/plugin-guest.js` beside the module it is bundled into.
 */
export const commandLineBuild: Options = {
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  // Everything but the bootstrap, which the second build writes and cleans on its own: the
  // two run at the same time, and a plain `clean` here would race it.
  clean: ['!guest/**'],
};

export default defineConfig([commandLineBuild, guestBuild]);
