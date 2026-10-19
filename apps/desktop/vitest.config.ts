import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The end-to-end suite launches a real Electron — a ~246 MB binary it downloads on
    // first use, and a window — so it is not part of `pnpm check`, the same arrangement
    // `packages/raster` makes for its visual suite. `pnpm test:desktop` runs it from its
    // own config. `launch-isolation` is the exception that proves it: it reads the suites'
    // source and launches nothing, so every pull request runs it (TYTO-139).
    // `asar-patch` is pure byte work for the packaged suite, and is checked here for the same
    // reason (TYTO-241). So is `port-file`, the CDP harness reading Chromium's port (TYTO-95).
    // And `renderer-tokens`, which reads the renderer's sheets for literals and for token
    // names nothing defines (TYTO-96).
    // And the manual's scene list, which is data and launches nothing (TYTO-315).
    // And where the global setup finds the Electron binary, which only reads paths (TYTO-327).
    include: [
      'shared/**/*.test.ts',
      'src/**/*.test.ts',
      'e2e/launch-isolation.test.ts',
      'e2e/renderer-tokens.test.ts',
      'e2e/asar-patch.test.ts',
      'e2e/port-file.test.ts',
      'e2e/electron-binary.test.ts',
      'e2e/docs-shots/**/*.test.ts',
    ],
  },
});
