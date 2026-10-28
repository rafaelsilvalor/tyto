import type { GuestChannel, PluginChannel } from './channel.js';

/** The runtime's own, read off `globalThis`: this package names no platform (ADR 0010). */
const { structuredClone, queueMicrotask } = globalThis as unknown as {
  structuredClone<T>(value: T): T;
  queueMicrotask(callback: () => void): void;
};

/**
 * Both ends of one plugin channel in this process, for the test harness (ADR 0150).
 *
 * Every message is cloned at the sender and delivered on a later microtask, as `postMessage`
 * does, so a value that cannot cross a process boundary fails here too, and no answer arrives
 * before the call that asked for it has returned. Nothing ends the guest but `close`, so
 * `onExit` never fires.
 */
export function inProcessChannel(start: (guest: GuestChannel) => void): PluginChannel {
  const toHost = new Set<(message: unknown) => void>();
  const toGuest = new Set<(message: unknown) => void>();
  let ended = false;

  const deliver = (listeners: Set<(message: unknown) => void>, message: unknown): void => {
    const copy = structuredClone(message);
    queueMicrotask(() => {
      if (ended) return;
      for (const listener of listeners) listener(copy);
    });
  };

  start({
    send: (message) => deliver(toHost, message),
    onMessage: (listener) => void toGuest.add(listener),
  });

  return {
    send: (message) => deliver(toGuest, message),
    onMessage: (listener) => void toHost.add(listener),
    onExit: () => undefined,
    keepAlive: () => undefined,
    close: () => {
      ended = true;
      return Promise.resolve();
    },
  };
}
