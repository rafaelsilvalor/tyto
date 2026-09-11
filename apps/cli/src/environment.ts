import { createRequire } from 'node:module';

import { type Rasterizer, createPlaywrightRasterizer } from '@tyto/raster';

/**
 * Everything the commands reach for that is not a pure function of their arguments.
 *
 * A CLI is a composition root (ADR 0010), and a composition root that reads
 * `process.stdout` and launches Chromium from inside its command handlers is one no test
 * can drive. So the two capabilities are values here: a place to write, and a way to make
 * a rasterizer. `defaultEnvironment()` fills them in with the real ones, and the tests
 * pass a buffer and a fake.
 *
 * Nothing else belongs in here. The filesystem is reached through `@tyto/io`'s adapters,
 * which are already injectable by being arguments.
 */

/** Where a command writes. Two streams, because a pipe should get the output and not the noise. */
export interface CliConsole {
  /** The answer: artifact names, `--json`, scaffolded paths. */
  out(text: string): void;
  /** Diagnostics and progress. */
  err(text: string): void;
}

export interface CliEnvironment {
  readonly console: CliConsole;
  /**
   * `tyto`'s own version, as it reaches `result.json`'s `tyto.version`.
   *
   * A value rather than a call, so a test can pin it: a document asserted against a
   * version that changes every release is a document asserted against nothing.
   */
  readonly version: string;
  /** Relative paths on the command line resolve against this. */
  readonly cwd: string;
  /**
   * Built on demand, and only by a command that has a raster output to produce.
   *
   * A factory rather than a `Rasterizer`, so `tyto render --types svg` never pays for a
   * browser and `tyto template check` never mentions one. It may throw — a machine
   * without `playwright` installed is exactly that — and a throw here is an internal
   * failure (exit 2) rather than a diagnostic about anybody's brief.
   */
  rasterizer(): CliRasterizer;
}

/**
 * A `Rasterizer` that may own a browser.
 *
 * `close` is optional because the port does not have one — a fake in a test holds nothing
 * to release — and a `tyto render` that left Chromium running would be a command that
 * never returns to the shell.
 */
export type CliRasterizer = Rasterizer & { close?: () => Promise<void> };

/** `tyto`'s own version, for `result.json`'s `tyto.version` and `--version`. */
export function cliVersion(): string {
  // Read rather than inlined at build time: `../package.json` is this package's manifest
  // from `src/` under Vitest and from `dist/` after tsup, so one expression is right in
  // both. A build-time define would need the same value threaded through tsc and Vitest
  // as well, for a string that is on disk either way.
  const require = createRequire(import.meta.url);
  const manifest = require('../package.json') as { readonly version?: string };
  return manifest.version ?? '0.0.0';
}

export function defaultEnvironment(): CliEnvironment {
  return {
    console: {
      out: (text) => {
        process.stdout.write(text);
      },
      err: (text) => {
        process.stderr.write(text);
      },
    },
    version: cliVersion(),
    cwd: process.cwd(),
    rasterizer: () => createPlaywrightRasterizer(),
  };
}
