import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { type CliEnvironment, type CliRasterizer, launchPluginProcess } from '@tyto/command-line';
import { createPlaywrightRasterizer } from '@tyto/raster';

/**
 * The terminal's environment for `@tyto/command-line`'s commands (ADR 0159).
 *
 * A CLI is a composition root (ADR 0010): this is where each port the command tree declares
 * gets the adapter a terminal has. `process.stdout` and `process.stderr` for the console, a
 * `[y/N]` line when there is a terminal to ask, `fork` on the running Node for a plugin's
 * process, and Playwright's Chromium for a raster. The window fills the same ports with its
 * own (`apps/desktop`), and the tests with a buffer and a fake.
 */

/**
 * Playwright's Chromium, unlaunched, and the only place in this app that names a Chromium.
 *
 * A factory rather than an instance, so a command with nothing to raster never pays for a
 * browser. It may throw — a machine without `playwright` installed is exactly that — and
 * that throw is an internal failure (exit 2), not a diagnostic about anybody's brief.
 */
export function defaultRasterizer(): CliRasterizer {
  return createPlaywrightRasterizer();
}

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
    variables: process.env,
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
    launch: launchPluginProcess,
  };
}
