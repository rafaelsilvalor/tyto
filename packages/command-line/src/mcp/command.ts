import { resolve } from 'node:path';

import type { CliEnvironment, CliStdio } from '../environment.js';
import { EXIT_INTERNAL, EXIT_OK, type ExitCode } from '../exit.js';
import { openSession } from './session.js';

/**
 * `tyto mcp` — Tyto as a Model Context Protocol server on stdio, for an AI agent (ADR 0179).
 *
 * Runs until the client closes stdin. Every byte on stdout from then on is a protocol frame:
 * the commands this reuses print through a console whose both streams go to stderr, the app's
 * `stdio` port routes the process's own stdout writes there too, and a plugin's process never
 * had this one's stdout to begin with (`plugin-process.ts`).
 */

export const NO_STDIO =
  'tyto mcp: this program has no standard streams to serve on; run tyto mcp in a terminal, or register it with an agent that starts it (ADR 0179)\n';

export interface McpOptions {
  /** Relay to a running window instead of serving the files (ADR 0180). */
  readonly window?: boolean;
}

export async function mcpCommand(
  folder: string,
  environment: CliEnvironment,
  signal?: AbortSignal,
  options: McpOptions = {},
): Promise<ExitCode> {
  if (environment.stdio === undefined) {
    environment.console.err(NO_STDIO);
    return EXIT_INTERNAL;
  }
  const stdio = environment.stdio();
  if (options.window === true) {
    // The window serves the protocol; this process only copies bytes, so it loads no SDK.
    const { relayToWindow } = await import('./relay.js');
    return relayToWindow({
      home: environment.home,
      folder: resolve(environment.cwd, folder),
      platform: process.platform,
      stdio,
      err: environment.console.err,
      ...(signal === undefined ? {} : { signal }),
    });
  }
  await serveAgent({ ...environment, cwd: resolve(environment.cwd, folder) }, stdio, signal);
  return EXIT_OK;
}

/**
 * Serves the MCP tools on two streams until the client closes its end, or `signal` fires: what
 * `tyto mcp` does on stdio, and what the window does on each connection to its endpoint (ADR
 * 0180), so the two offer the same tools under the same trust rules. `environment.cwd` is the
 * folder served.
 */
export async function serveAgent(
  environment: CliEnvironment,
  stdio: CliStdio,
  signal?: AbortSignal,
  /** What the start line says it serves on: `stdio`, or the window's connection. */
  on = 'stdio',
): Promise<void> {
  const err = environment.console.err;
  // Everything the reused commands print goes to stderr, their answers included: the stream
  // is the protocol's now, and an answer a tool needs comes back as a value, not as printed
  // text. Relative paths an agent gives resolve against `cwd`, and its workspace is the one
  // served.
  const quiet: CliEnvironment = { ...environment, console: { out: err, err } };

  // Lazy, so the SDK is loaded when an agent connects and not before: tsup splits it into a
  // chunk of its own beside `index.js`, and the window's bundle does the same (ADR 0180).
  const { serveMcp } = await import('./server.js');
  const session = await openSession(quiet);
  try {
    err(`tyto mcp: serving on ${on}, workspace ${session.trust} (${session.roots.join(', ')})
`);
    await serveMcp(session, stdio, {
      version: environment.version,
      err,
      ...(signal === undefined ? {} : { signal }),
    });
  } finally {
    await session.close();
  }
}
