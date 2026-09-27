import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

import { runGuest } from '@tyto/plugin-api';

/**
 * The first code an installed plugin's worker thread runs (E11.2, ADR 0041).
 *
 * Its own bundle — `dist/plugin-worker.js`, beside `dist/index.js` — because a worker
 * starts from a file, and it imports nothing relative for the same reason: under Vitest
 * this file runs as TypeScript straight from `src/`, which Node strips of its types and
 * does not resolve `.js` specifiers for. Everything the guest does is `runGuest`'s.
 *
 * **A thread, not a sandbox.** The plugin's code runs with the same Node as Tyto's and can
 * import `node:fs` itself; what this boundary buys is that a crash is the thread's and not
 * the CLI's, and that everything the plugin asks of Tyto crosses as a checked message.
 * A real boundary is TYTO-186.
 */

const { entry } = workerData as { readonly entry: string };
const port = parentPort;
if (port === null) {
  throw new TypeError('plugin-worker is a worker thread entry and was started as a script.');
}

runGuest(
  {
    send: (message) => port.postMessage(message),
    onMessage: (listener) => port.on('message', listener),
  },
  () => import(pathToFileURL(entry).href),
);
