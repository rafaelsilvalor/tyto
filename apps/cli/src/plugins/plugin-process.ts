import { fork } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { PluginChannel, PluginProcessLauncher, PluginProcessRequest } from '@tyto/plugin-api';

/**
 * `@tyto/plugin-api`'s `PluginChannel`, on a child process under Node's permission model
 * (E11.2, ADR 0041, ADR 0049).
 *
 * One process per installed plugin, for the life of the command, started from
 * `dist/guest/plugin-guest.js` with `--permission` and read access to two paths only: the
 * plugin's folder and that bootstrap. Nothing else is granted, so the plugin cannot read
 * outside its folder, write anywhere, start a process or a worker, or load an addon.
 *
 * **A child process and not a worker thread**, because a worker cannot be narrower than the
 * thread that starts it: given the same flags in `execArgv`, a worker refused a read outside
 * its grant from 2 of 6 working directories, and a child process from 6 of 6 (ADR 0049).
 *
 * **Every granted path is its real path.** On macOS the temporary folder is under `/var`, a
 * link to `/private/var`, and a grant on the linked path refused the child its own entry file
 * (`resource: '/var'`, measured on CI). The module paths the child is given are real paths for
 * the same reason.
 *
 * **The environment is not the CLI's.** The permission model does not confine
 * `process.env`, and the CLI's holds every plugin's `TYTO_PLUGIN_*` credential (ADR 0042), so
 * the child is started with an empty one (on Windows, libuv's required variables come back).
 */

/**
 * The environment variable `vitest.guest-setup.ts` names its build in. Read only when this
 * module runs from its `.ts` source, which only the tests do: a source file has no
 * `dist/guest/` beside it, and a test that runs `tyto render` in process starts plugins
 * through {@link launchPluginProcess} like the CLI does.
 */
export const TEST_GUEST_VARIABLE = 'TYTO_TEST_PLUGIN_GUEST';

/** Where `tsup` writes the bootstrap, beside the CLI's own bundle (`tsup.config.ts`). */
function bundledGuest(): string {
  const fromTests = process.env[TEST_GUEST_VARIABLE];
  if (import.meta.url.endsWith('.ts') && fromTests !== undefined) return fromTests;
  return fileURLToPath(new URL('./guest/plugin-guest.js', import.meta.url));
}

/**
 * A file that exists and that the child must not be able to read: this module's own. In the
 * build it is `dist/index.js` or one of its chunks; under Vitest it is this `.ts`.
 */
const CANARY = fileURLToPath(import.meta.url);

/** Whether this Node knows the permission model's flag at all; 22.13 and 23.5 on (ADR 0049). */
export function nodeHasPermissionModel(): boolean {
  return process.allowedNodeEnvironmentFlags.has('--permission');
}

/**
 * The flags a plugin's process starts with.
 *
 * Empty on a Node without the model: the child then starts unconfined, its canary reads the
 * file, and the host refuses the plugin by name before its code is imported. That is one
 * refusal path for "this runtime cannot confine" whatever the reason, rather than a second
 * one that trusts a version number (ADR 0049).
 */
export function sandboxFlags(grants: readonly string[]): string[] {
  if (!nodeHasPermissionModel()) return [];
  return ['--permission', ...grants.map((path) => `--allow-fs-read=${path}`)];
}

/**
 * The variables libuv puts back into every process it starts on Windows, whatever it was given
 * (`required_vars` in its `process.c`): the machine's and the user's names and folders, which
 * Windows needs to run a program at all. None of them is Tyto's or a plugin's, measured: a
 * child started with an empty environment sees exactly these.
 */
export const WINDOWS_REQUIRED_VARIABLES: readonly string[] = [
  'HOMEDRIVE',
  'HOMEPATH',
  'LOGONSERVER',
  'PATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
];

/** `{ fatal: message }`, which only the bootstrap sends, and only as it dies. */
function fatalOf(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const keys = Object.keys(message);
  const fatal = (message as { readonly fatal?: unknown }).fatal;
  return keys.length === 1 && typeof fatal === 'string' ? fatal : undefined;
}

export interface PluginProcessOptions {
  /** The bootstrap to start. The bundled one unless a test built its own. */
  readonly guest?: string;
  /**
   * The flags for a set of grants: {@link sandboxFlags} unless a test stands in for a
   * runtime that has no permission model.
   */
  readonly flags?: (grants: readonly string[]) => string[];
}

export function pluginProcessLauncher(options: PluginProcessOptions = {}): PluginProcessLauncher {
  return (request: PluginProcessRequest): PluginChannel => {
    const guest = realpathSync(options.guest ?? bundledGuest());
    const child = fork(guest, [realpathSync(request.entry), realpathSync(CANARY)], {
      // Only these: the parent's own `execArgv` (a loader, an inspector) is not the plugin's.
      execArgv: (options.flags ?? sandboxFlags)([realpathSync(request.directory), guest]),
      // Empty. On Windows libuv adds back {@link WINDOWS_REQUIRED_VARIABLES}, and nothing else.
      env: {},
      // Structured clone, so `host.fetch`'s body crosses as a `Uint8Array` the way it did
      // across a worker's port, rather than as JSON.
      serialization: 'advanced',
      // Inherited, so a plugin's own `console` lands where it did in a worker thread.
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const exits = new Set<(reason: string) => void>();
    let closing = false;
    let failure: string | undefined;
    let markExited = (): void => undefined;
    const exited = new Promise<void>((resolve) => {
      markExited = resolve;
    });

    // A process that could not be started, or a message that could not be sent.
    child.on('error', (cause) => {
      failure = cause.message;
    });
    child.on('exit', (code, signal) => {
      markExited();
      if (closing) return;
      const reason =
        failure ??
        (signal === null
          ? `its process exited with code ${String(code)}`
          : `its process was ended by ${signal}`);
      for (const listener of exits) listener(reason);
    });

    return {
      send: (message) => void child.send(message),
      onMessage: (listener) =>
        void child.on('message', (message: unknown) => {
          // The bootstrap's last word before an uncaught throw ends it (`plugin-guest.ts`).
          const fatal = fatalOf(message);
          if (fatal === undefined) listener(message);
          else failure = fatal;
        }),
      onExit: (listener) => void exits.add(listener),
      keepAlive: (active) => {
        // Both, because the IPC channel holds the event loop open on its own.
        if (active) {
          child.ref();
          child.channel?.ref();
        } else {
          child.unref();
          child.channel?.unref();
        }
      },
      async close() {
        closing = true;
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill();
        await exited;
      },
    };
  };
}

/** The CLI's launcher: the bundled bootstrap. */
export const launchPluginProcess: PluginProcessLauncher = pluginProcessLauncher();
