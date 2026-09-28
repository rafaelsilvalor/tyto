import type { PluginChannel, PluginProcessLauncher } from '@tyto/plugin-api';

import { decodeFromWire, encodeForWire } from './plugin-wire.js';

/**
 * `@tyto/plugin-api`'s `PluginChannel`, on a child process of the Node bundled with the app,
 * under Node's permission model (E11.2, ADR 0044, ADR 0049, ADR 0050).
 *
 * One process per installed plugin, for the life of the app, running
 * `out/guest/plugin-guest.js` on `resources/node/` (a package) or `out/node/` (development),
 * with `--permission` and read access to the plugin's folder and to that bootstrap, both as
 * real paths, and nothing else. Not a `utilityProcess`: Electron's accepts `--permission` and
 * does not enforce it, measured on 44.4.1 (ADR 0049).
 *
 * The CLI's `plugin-process.ts` twin. The two apps cannot import each other, and what the two
 * launchers decide is small enough that a copy beats a package made to hold it.
 *
 * `fork` and `realpath` are taken as arguments, so the composition root binds Node's and a
 * test passes fakes that record what they were asked.
 */

/** The slice of Node's `ChildProcess` this uses. */
export interface NodeChild {
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  send(message: unknown): boolean;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
  on(event: 'error', listener: (cause: Error) => void): unknown;
  kill(): boolean;
}

/** What `fork` is asked for, as far as this module asks it. */
export interface ForkOptions {
  readonly execPath: string;
  readonly execArgv: string[];
  readonly env: Record<string, string>;
  readonly serialization: 'json';
  readonly stdio: ['ignore', 'inherit', 'inherit', 'ipc'];
}

/** `child_process.fork`, as far as this module calls it. */
export type ForkNode = (modulePath: string, args: string[], options: ForkOptions) => NodeChild;

export interface BundledNodeOptions {
  readonly fork: ForkNode;
  /** `fs.realpathSync`; every path the child is given or granted is a real one (ADR 0049). */
  readonly realpath: (path: string) => string;
  /** The bundled Node binary. */
  readonly node: string;
  /** The bootstrap, `out/guest/plugin-guest.js`, outside any asar. */
  readonly guest: string;
  /** A file that exists and that the child must not be able to read. */
  readonly canary: string;
}

/** `{ fatal: message }`, which only the bootstrap sends, and only as it dies. */
function fatalOf(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const fatal = (message as { readonly fatal?: unknown }).fatal;
  return Object.keys(message).length === 1 && typeof fatal === 'string' ? fatal : undefined;
}

export function bundledNodeLauncher(options: BundledNodeOptions): PluginProcessLauncher {
  return (request): PluginChannel => {
    const guest = options.realpath(options.guest);
    const grants = [options.realpath(request.directory), guest];
    const child = options.fork(
      guest,
      [options.realpath(request.entry), options.realpath(options.canary)],
      {
        execPath: options.node,
        // The bundled Node is 24, which knows the model; the canary is what proves it.
        execArgv: ['--permission', ...grants.map((path) => `--allow-fs-read=${path}`)],
        // Empty: the permission model does not confine `process.env`. On Windows libuv adds its
        // required variables back, and none of them is the app's.
        env: {},
        // JSON, with bytes and undefined encoded (`plugin-wire.ts`): main's V8 is Electron's and the
        // plugin's is Node's, and their structured clones do not read each other's.
        serialization: 'json',
        // Inherited, so a plugin's own `console` lands where main's does: the terminal in
        // development, nowhere in a packaged build. Its `host.log` lines reach the app's log.
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      },
    );
    const exits = new Set<(reason: string) => void>();
    let closing = false;
    let ended = false;
    let failure: string | undefined;
    let markExited = (): void => undefined;
    const exited = new Promise<void>((resolve) => {
      markExited = resolve;
    });

    function end(reason: string): void {
      if (ended) return;
      ended = true;
      markExited();
      if (closing) return;
      for (const listener of exits) listener(reason);
    }

    child.on('error', (cause) => {
      failure = cause.message;
      // A binary that could not be started never exits, so its failure is the exit.
      if (child.pid === undefined) end(`its process could not start: ${cause.message}`);
    });
    child.on('exit', (code, signal) => {
      end(
        failure ??
          (signal === null
            ? `its process exited with code ${String(code)}`
            : `its process was ended by ${signal}`),
      );
    });

    return {
      send: (message) => void child.send(encodeForWire(message)),
      onMessage: (listener) =>
        void child.on('message', (message) => {
          const fatal = fatalOf(message);
          if (fatal === undefined) listener(decodeFromWire(message));
          else failure = fatal;
        }),
      onExit: (listener) => void exits.add(listener),
      // A child does not hold the app open the way a worker holds Node's event loop: the app
      // ends when its windows do, and `will-quit` closes every plugin. Nothing to reference.
      keepAlive: () => undefined,
      async close() {
        closing = true;
        if (ended || child.exitCode !== null || child.signalCode !== null) return;
        if (!child.kill()) return;
        await exited;
      },
    };
  };
}

export interface BundledNodePaths {
  readonly node: string;
  readonly guest: string;
  readonly canary: string;
}

/**
 * Where the bundled Node, the bootstrap and the canary are, from main's own bundle.
 *
 * - **Packaged:** main runs from inside `resources/app.asar`. The Node is an extra resource,
 *   `resources/node/`, and the bootstrap is unpacked beside the asar in `app.asar.unpacked`,
 *   because the bundled Node is not Electron and cannot read inside one. The canary is the
 *   asar file itself: it always exists, and a plugin has no business reading it.
 * - **Development:** everything is under `out/`, and the canary is main's own `index.js`.
 *
 * `join` is the platform's, passed in so a test can check both shapes on any machine.
 */
export function bundledNodePaths(options: {
  readonly packaged: boolean;
  /** `out/main`, the folder main's bundle is in. */
  readonly mainDirectory: string;
  readonly mainFile: string;
  readonly resourcesPath: string;
  readonly platform: string;
  readonly join: (...parts: string[]) => string;
}): BundledNodePaths {
  const { join } = options;
  const binary = options.platform === 'win32' ? 'node.exe' : 'node';
  const guest = join(options.mainDirectory, '..', 'guest', 'plugin-guest.js');
  if (!options.packaged) {
    return {
      node: join(options.mainDirectory, '..', 'node', binary),
      guest,
      canary: options.mainFile,
    };
  }
  const asar = join(options.resourcesPath, 'app.asar');
  return {
    node: join(options.resourcesPath, 'node', binary),
    guest: join(options.resourcesPath, 'app.asar.unpacked', 'out', 'guest', 'plugin-guest.js'),
    canary: asar,
  };
}
