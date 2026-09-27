import type { PluginChannel, PluginProcessLauncher } from '@tyto/plugin-api';

/**
 * `@tyto/plugin-api`'s `PluginChannel`, on an Electron `utilityProcess` (E11.2, ADR 0044).
 *
 * The desktop's second adapter for the port the CLI implements on `worker_threads`: one
 * process per installed plugin, for the life of the app, running `plugin-guest.js`. A
 * process rather than a thread because that is what Electron offers main for untrusted
 * work, and because a plugin that ends its process ends nothing of the window's.
 *
 * `fork` is taken as an argument rather than imported, for `credentials.ts`'s reason: a
 * top-level `import { utilityProcess } from 'electron'` is a path string outside Electron,
 * so the composition root binds it and a test passes a fake that records what it was asked.
 */

/** The slice of Electron's `UtilityProcess` this uses. */
export interface UtilityChild {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  on(event: 'error', listener: (type: string, location: string) => void): unknown;
  kill(): boolean;
}

/** `utilityProcess.fork`, as far as this module calls it. */
export type ForkUtility = (
  modulePath: string,
  args: string[],
  options: { readonly serviceName: string; readonly stdio: 'inherit' },
) => UtilityChild;

export function utilityProcessLauncher(fork: ForkUtility, guest: string): PluginProcessLauncher {
  return (request): PluginChannel => {
    const child = fork(guest, [request.entry], {
      serviceName: `Tyto plugin ${request.name}`,
      // Inherited, so a plugin's own `console` lands where main's does: the terminal in
      // development, nowhere in a packaged build. Its `host.log` lines are what reach the
      // app's log.
      stdio: 'inherit',
    });
    const exits = new Set<(reason: string) => void>();
    let closing = false;
    let failure: string | undefined;
    let markExited = (): void => undefined;
    const exited = new Promise<void>((resolve) => {
      markExited = resolve;
    });

    // A fatal error in the child arrives here before `exit`; it is the better reason.
    child.on('error', (type, location) => {
      failure = `its process failed (${type}${location === '' ? '' : ` at ${location}`})`;
    });
    child.on('exit', (code) => {
      markExited();
      if (closing) return;
      const reason = failure ?? `its process exited with code ${String(code)}`;
      for (const listener of exits) listener(reason);
    });

    return {
      send: (message) => child.postMessage(message),
      onMessage: (listener) => void child.on('message', listener),
      onExit: (listener) => void exits.add(listener),
      // A utility process does not hold the app open the way a worker holds Node's event
      // loop: the app ends when its windows do. Nothing to reference or release.
      keepAlive: () => undefined,
      async close() {
        closing = true;
        if (!child.kill()) return;
        await exited;
      },
    };
  };
}
