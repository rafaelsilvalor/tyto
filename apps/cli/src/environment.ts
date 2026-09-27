import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { type CloseableRasterizer, defaultRasterizer } from './plugins/rasterizer.js';

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
  /**
   * `~/.tyto`, where `tyto plugin install` puts plugins and records what it approved.
   *
   * Optional, and absent means **no installed plugins at all**: a test that does not name a
   * folder of its own must never read the real one, and a missing field is the one default
   * that cannot leak somebody's machine into a snapshot.
   */
  readonly home?: string;
  /**
   * Asks a yes-or-no question on the terminal. Absent when nobody is there to answer — a
   * pipe, a CI job — and then `install` needs `--yes` rather than guessing.
   */
  readonly confirm?: (question: string) => Promise<boolean>;
}

/**
 * A `Rasterizer` that may own a browser.
 *
 * `close` is optional because the port does not have one — a fake in a test holds nothing
 * to release — and a `tyto render` that left Chromium running would be a command that
 * never returns to the shell. Declared beside the registration module that builds one, so
 * `@tyto/raster`'s adapter is named in exactly one file (ADR 0007, ADR 0010).
 */
export type CliRasterizer = CloseableRasterizer;

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

/**
 * `~/.tyto`, or wherever `TYTO_HOME` points (`docs/plugin-api.md`, Lifecycle).
 *
 * The desktop reads the same variable (`apps/desktop/src/main/plugin-list.ts`), so the two
 * apps always agree about which plugins are installed. An empty value counts as unset: a
 * shell that exported `TYTO_HOME=` meant nothing by it, and a relative empty path would be
 * the current folder.
 */
export function tytoHome(environment: NodeJS.ProcessEnv = process.env): string {
  const named = environment['TYTO_HOME'];
  return named !== undefined && named !== '' ? named : join(homedir(), '.tyto');
}

/** `y` or `yes`, any case. Anything else — an empty line included — is a no. */
async function askOnTerminal(question: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await terminal.question(question);
    return /^y(es)?$/iu.test(answer.trim());
  } finally {
    terminal.close();
  }
}

export function defaultEnvironment(): CliEnvironment {
  return {
    home: tytoHome(),
    ...(process.stdin.isTTY ? { confirm: askOnTerminal } : {}),
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
    rasterizer: defaultRasterizer,
  };
}
