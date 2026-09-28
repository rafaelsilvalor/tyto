import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { type SandboxReport, runGuest } from '@tyto/plugin-api';

import { decodeFromWire, encodeForWire } from './plugin-wire.js';

/**
 * The first code an installed plugin's process runs on the desktop (E11.2, ADR 0044,
 * ADR 0050).
 *
 * The CLI's `plugin-guest.ts` twin: the same bootstrap, on the Node bundled with the app rather
 * than on the CLI's, and built on its own into `out/guest/plugin-guest.js` with everything
 * inlined (`vite.guest.config.ts`). The two apps cannot import each other, and the whole of
 * what they share is `runGuest`, which is `@tyto/plugin-api`'s.
 *
 * Its arguments are the plugin's module and a file that exists outside the process's grant:
 * the app's own `app.asar` in a package, `out/main/index.js` in development. **That file is
 * read before the plugin's module is imported**, and the answer crosses in `hello`. Only
 * `ERR_ACCESS_DENIED` proves the permission model is enforcing, and the desktop's host refuses
 * the plugin on any other answer (ADR 0049).
 */

const [entry, canary] = process.argv.slice(2);
const parent = process.send?.bind(process);
if (entry === undefined || canary === undefined || parent === undefined) {
  throw new TypeError('plugin-guest is started by the app with a plugin module and a canary file.');
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

// Gone before the plugin loads, so the obvious way to the network is the checked one,
// `host.fetch` (ADR 0042). The bundled Node is 24, whose permission model does not confine the
// network, so a plugin that imports `node:net` still reaches it (ADR 0049).
delete (globalThis as { fetch?: unknown }).fetch;

// The app that started this process is gone, and nothing is left to answer.
process.on('disconnect', () => process.exit(0));

// An uncaught throw ends the process with a code and no reason; the launcher is told first,
// so the crash is recorded with the error itself (`plugin-process.ts`).
process.on('uncaughtException', (cause) => {
  const fatal = cause instanceof Error ? cause.message : String(cause);
  parent({ fatal }, () => process.exit(1));
});

runGuest(
  {
    // JSON across the channel, with bytes and undefined encoded as main does (`plugin-wire.ts`).
    send: (message) => void parent(encodeForWire(message)),
    onMessage: (listener) =>
      void process.on('message', (message) => listener(decodeFromWire(message))),
  },
  () => import(pathToFileURL(entry).href),
  sandbox,
);
