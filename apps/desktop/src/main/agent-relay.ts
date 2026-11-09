import { homedir } from 'node:os';
import { join } from 'node:path';

import { WINDOW_PID_VARIABLE, relayToWindow, windowPidOf } from '@tyto/command-line/relay';

/**
 * The relay an agent started from a Tyto terminal registers (TYTO-567, ADR 0181): what
 * `tyto mcp --window` does, without the rest of `tyto`. ADR 0164 decision 4 keeps `tyto` off the
 * terminal's PATH, and the package ships no runnable `tyto` (TYTO-335), so an agent's MCP
 * configuration names this file and the Node the app already carries for its plugins (ADR 0050).
 *
 * Built on its own into `out/relay/agent-relay.js` with every dependency inlined
 * (`vite.relay.config.ts`) and unpacked from the asar: the bundled Node is not Electron and
 * cannot read inside one. It copies bytes between its stdio and the window; it reads no frame.
 */

const variables = process.env;
const named = windowPidOf(variables[WINDOW_PID_VARIABLE]);
const home = variables['TYTO_HOME'];

const code = await relayToWindow({
  home: home !== undefined && home !== '' ? home : join(homedir(), '.tyto'),
  folder: process.cwd(),
  platform: process.platform,
  stdio: { input: process.stdin, output: process.stdout },
  err: (text) => {
    process.stderr.write(text);
  },
  ...(named === undefined ? {} : { named }),
});
process.exitCode = code;
// The window may still hold the connection open; the agent closing its end is the end.
process.stdin.destroy();
