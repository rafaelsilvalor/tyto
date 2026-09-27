import { Worker } from 'node:worker_threads';

import type { PluginChannel, PluginProcessRequest } from '@tyto/plugin-api';

/**
 * `@tyto/plugin-api`'s `PluginChannel`, on a `worker_threads` worker (E11.2, ADR 0041).
 *
 * One worker per installed plugin, for the life of the command. The worker's file is
 * `plugin-worker.js` beside the bundle this module is inlined into; under Vitest this
 * module is the `.ts` in `src/plugins/`, and the worker is the `.ts` beside it, which Node
 * runs with its types stripped.
 */

const WORKER_FILE = new URL(
  import.meta.url.endsWith('.ts') ? './plugin-worker.ts' : './plugin-worker.js',
  import.meta.url,
);

export function launchPluginWorker(request: PluginProcessRequest): PluginChannel {
  const worker = new Worker(WORKER_FILE, {
    name: `tyto-plugin-${request.name}`,
    workerData: { entry: request.entry },
  });
  const exits = new Set<(reason: string) => void>();
  let closing = false;
  let failure: string | undefined;

  // An uncaught throw ends the thread with this event and then `exit`; the throw is the
  // better reason of the two, so it is kept for the moment the exit arrives.
  worker.on('error', (cause) => {
    failure = cause instanceof Error ? cause.message : String(cause);
  });
  worker.on('exit', (code) => {
    if (closing) return;
    const reason = failure ?? `its thread exited with code ${String(code)}`;
    for (const listener of exits) listener(reason);
  });

  return {
    send: (message) => worker.postMessage(message),
    onMessage: (listener) => void worker.on('message', listener),
    onExit: (listener) => void exits.add(listener),
    keepAlive: (active) => {
      if (active) worker.ref();
      else worker.unref();
    },
    async close() {
      closing = true;
      await worker.terminate();
    },
  };
}
