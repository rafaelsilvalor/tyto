import { resolve } from 'node:path';

import type { CliEnvironment } from '../environment.js';
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

export async function mcpCommand(
  folder: string,
  environment: CliEnvironment,
  signal?: AbortSignal,
): Promise<ExitCode> {
  if (environment.stdio === undefined) {
    environment.console.err(NO_STDIO);
    return EXIT_INTERNAL;
  }
  const stdio = environment.stdio();
  const err = environment.console.err;
  // Everything the reused commands print goes to stderr, their answers included: stdout is the
  // protocol's now, and an answer a tool needs comes back as a value, not as printed text.
  // And the folder named on the command line is the session's current folder: relative paths
  // an agent gives resolve against it, and its workspace is the one served.
  const quiet: CliEnvironment = {
    ...environment,
    cwd: resolve(environment.cwd, folder),
    console: { out: err, err },
  };

  // Lazy, so the SDK is loaded by this command alone: tsup splits it into a chunk of its own
  // beside `index.js`, and the window's bundle keeps it out of what main runs at start.
  const { serveMcp } = await import('./server.js');
  const session = await openSession(quiet);
  try {
    err(`tyto mcp: serving on stdio, workspace ${session.trust} (${session.roots.join(', ')})\n`);
    await serveMcp(session, stdio, {
      version: environment.version,
      err,
      ...(signal === undefined ? {} : { signal }),
    });
  } finally {
    await session.close();
  }
  return EXIT_OK;
}
