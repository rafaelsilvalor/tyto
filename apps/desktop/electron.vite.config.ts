import { resolve } from 'node:path';

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * Three builds, because there are three runtimes (ADR 0001).
 *
 * `main` is Node with Electron on top, `preload` is a sandboxed script that may reach
 * `electron` and almost nothing else, and `renderer` is a browser. electron-vite exists to
 * stop those from being one config with three sets of exceptions in it.
 *
 * `electron` is external in both, and that is not an optimisation — it is the difference
 * between an app that starts and one that does not. `electron` is a *devDependency*, so
 * `externalizeDepsPlugin` (which reads `dependencies`) leaves it alone and Rollup inlines the
 * package's Node-side shim: the `index.js` whose job is to print the path to the binary. That
 * shim uses `__dirname`, the bundle is ESM because this package is `"type": "module"`, and
 * the app dies at load with `ReferenceError: __dirname is not defined in ES module scope`.
 * Inside Electron the module is supplied by the runtime and must never be bundled at all.
 *
 * The workspace packages are bundled on purpose, which is the opposite call for the opposite
 * reason: `@tyto/core` and the rest are symlinks in a pnpm workspace, and an installer built
 * from a folder of symlinks is an installer that works on this machine only.
 *
 * The preload is the one with a real constraint rather than a preference. With
 * `sandbox: true` it runs without a module loader and without Node's `require` for anything
 * but `electron`, so it has to be a **single CommonJS file with its dependencies inside
 * it** — which is why `externalizeDepsPlugin` is not applied there and `zod` is bundled in.
 * Externalising it would produce a `require('zod')` the sandbox refuses at load, and the
 * symptom is a window with no `window.tyto` and nothing in the log.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // `playwright` is external for the opposite reason `electron` is: not because the
        // runtime supplies it, but because nothing here ever asks for it.
        //
        // E9.2 made main depend on `@tyto/pipeline` for `markupTemplateSource`, and pipeline
        // takes two functions from `@tyto/raster`, whose index re-exports the Playwright
        // adapter — so the bundler walks that adapter's `await import('playwright')` and
        // dies on a dependency of a dependency of Playwright:
        // `Rolldown failed to resolve import "chromium-bidi/lib/cjs/bidiMapper/BidiMapper"`.
        //
        // The desktop rasterizes through its own window (ADR 0002, E5.4), never through
        // Playwright, so the import is unreachable code the bundle should not contain. Left
        // external it stays a dynamic `import('playwright')` that nothing calls; if
        // something ever did, the adapter's own try/catch turns it into the sentence about
        // installing the optional peer, which is the right failure.
        // `@tyto/fonts` is external for a third reason again: it is the one workspace package
        // that reads files *relative to its own module*. `bundledFontsDirectory()` is
        // `../fonts` from `import.meta.url`, which is right from `src/index.ts` and from
        // `dist/index.js` and wrong from inside this bundle — inlined, it resolves to
        // `out/fonts` and every render dies with
        // `@tyto/fonts lists Source Sans 3 700 normal but cannot read …/out/fonts/…`.
        //
        // Found by opening the window, not by a test: the unit suites run from source, where
        // the path is correct (TYTO-41). Left external, the module keeps its own location and
        // `electron-builder.yml` ships the package beside the bundle, the same arrangement
        // `@tyto/templates` already has and for the same underlying reason — a folder of
        // bytes is not code and cannot be bundled into any amount of JavaScript.
        external: [
          'electron',
          '@tyto/fonts',
          /^playwright(?:-core)?(?:\/|$)/,
          /^chromium-bidi(?:\/|$)/,
        ],
        input: { index: resolve(import.meta.dirname, 'src/main/index.ts') },
      },
    },
  },

  preload: {
    build: {
      rollupOptions: {
        external: ['electron'],
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
        output: {
          // `.cjs` and not `.js`: the app is `"type": "module"`, so a `.js` preload would
          // be read as ESM and refused by the sandbox. `main/index.ts` names this file.
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },

  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') },
      },
    },
  },
});
