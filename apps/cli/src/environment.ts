import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { type Readable, Writable } from 'node:stream';

import {
  type CliEnvironment,
  type CliRasterizer,
  type CliStdio,
  launchPluginProcess,
} from '@tyto/command-line';
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

/** The three standard streams, injectable so a test claims its own and not Vitest's. */
export interface StandardStreams {
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
}

/**
 * Hands stdin and stdout to `tyto mcp` (ADR 0179), and from then on routes every other write to
 * stdout onto stderr.
 *
 * The protocol gets a stream of its own that writes through stdout's original `write`; then
 * stdout's `write` itself is replaced by stderr's. Node's `console.log` writes through that
 * method, as does a library that calls `process.stdout.write`, so a stray line anywhere in this
 * process lands on stderr instead of in the middle of a frame. A plugin's process never shared
 * this stdout (`plugin-process.ts`). For the rest of the process's life: `tyto mcp` is its last
 * command.
 */
export function claimStdio(streams: StandardStreams = process): CliStdio {
  const stdout = streams.stdout;
  const protocolWrite = stdout.write.bind(stdout) as Writable['write'];
  const output = new Writable({
    write(chunk: Buffer, encoding, done) {
      protocolWrite(chunk, encoding, done);
    },
  });
  stdout.write = streams.stderr.write.bind(streams.stderr) as typeof stdout.write;
  return { input: streams.stdin, output };
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
    stdio: () => claimStdio(),
  };
}
