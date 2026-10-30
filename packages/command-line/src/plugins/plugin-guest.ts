import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { type SandboxReport, runGuest } from '@tyto/plugin-api';

/**
 * The first code an installed plugin's process runs (E11.2, ADR 0041, ADR 0049).
 *
 * Its own bundle, `dist/guest/plugin-guest.js`, with `@tyto/plugin-api` and everything it
 * imports inlined: the process is started under Node's permission model with read access to
 * the plugin's folder and to this one file, so nothing may be left for it to resolve out of
 * `node_modules`. Everything the guest does is `runGuest`'s.
 *
 * Its arguments are the plugin's module and a file that exists outside the grant: the CLI's
 * own bundle. **That file is read before the plugin's module is imported**, and the answer
 * crosses in `hello`. A refusal (`ERR_ACCESS_DENIED`) is the only proof that the model is
 * enforcing rather than accepted and ignored, which is what a worker thread and Electron's
 * `utilityProcess` measured to do (ADR 0049). The host refuses the plugin on any other
 * answer, and the plugin's code is never loaded.
 */

const [entry, canary] = process.argv.slice(2);
const parent = process.send?.bind(process);
if (entry === undefined || canary === undefined || parent === undefined) {
  throw new TypeError('plugin-guest is started by the CLI with a plugin module and a canary file.');
}

function confinement(outside: string): SandboxReport {
  const runtime = `Node ${process.version}`;
  try {
    readFileSync(outside);
    return { runtime, canary: 'readable', detail: `it read ${outside}` };
  } catch (cause) {
    const code = (cause as { readonly code?: unknown } | undefined)?.code;
    if (code === 'ERR_ACCESS_DENIED') return { runtime, canary: 'denied', detail: '' };
    return {
      runtime,
      canary: 'failed',
      detail: `reading ${outside} failed with ${typeof code === 'string' ? code : String(cause)}`,
    };
  }
}

const sandbox = confinement(canary);

// Gone before the plugin's module is imported, so the obvious way to reach the network is the
// one that is checked: `host.fetch` (ADR 0042). The permission model of the Node versions the
// CLI supports does not confine the network, so a plugin that imports `node:net` still reaches
// it (ADR 0049).
delete (globalThis as { fetch?: unknown }).fetch;

// The CLI that started this process is gone: nothing is left to answer, and a plugin that
// kept the process alive would outlive the command that ran it.
process.on('disconnect', () => process.exit(0));

// A throw nothing caught ends the process with an exit code and no reason. A worker thread
// handed its host the error itself, and `crashes.json` names it, so the message is sent to
// the launcher first. It is the adapter's message, not the protocol's: `fatal` never reaches
// `connectIsolatedPlugin`.
process.on('uncaughtException', (cause) => {
  const fatal = cause instanceof Error ? cause.message : String(cause);
  parent({ fatal }, () => process.exit(1));
});

runGuest(
  {
    send: (message) => void parent(message),
    onMessage: (listener) => void process.on('message', listener),
  },
  () => import(pathToFileURL(entry).href),
  sandbox,
);
