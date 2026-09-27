import { pathToFileURL } from 'node:url';

import { runGuest } from '@tyto/plugin-api';

/**
 * The first code an installed plugin's `utilityProcess` runs (E11.2, ADR 0044).
 *
 * Its own bundle — `out/main/plugin-guest.js`, beside `index.js` — because a utility
 * process starts from a file. Everything the guest does is `runGuest`'s, the same one the
 * CLI's worker runs (ADR 0041); this is only the desktop's end of the pipe:
 * `process.parentPort`, and the plugin's module path as the one argument.
 *
 * **A process, and still not a sandbox.** The plugin's code runs on Electron's Node with
 * the same access to this computer as Tyto has; a crash is the process's and not the
 * window's, and everything it asks of Tyto crosses as a checked message (TYTO-186).
 */

const entry = process.argv[2];
const port = process.parentPort;
if (entry === undefined) {
  throw new TypeError('plugin-guest was started without the path of a plugin module.');
}

// Gone before the plugin loads, so the obvious way to the network is the checked one,
// `host.fetch` (ADR 0042). A plugin that imports `node:http` is not stopped by this.
delete (globalThis as { fetch?: unknown }).fetch;

runGuest(
  {
    send: (message) => port.postMessage(message),
    onMessage: (listener) => port.on('message', (event) => listener(event.data)),
  },
  () => import(pathToFileURL(entry).href),
);
