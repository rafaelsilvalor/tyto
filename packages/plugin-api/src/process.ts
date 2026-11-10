import { diagnostic } from '@tyto/core';

import { type HostCapabilities, PluginCapabilityError, bytesOf } from './capabilities.js';

/**
 * A program the host starts for a plugin, by name (ADR 0182).
 *
 * **One program per permission, named, never a path.** `process:claude` lets the plugin start
 * the program the host finds as `claude` on the person's `PATH`, and nothing else: no wildcard,
 * no folder, no extension, because a person approving `process:claude` reads one name and
 * knows which program that is. Each further program is one more line the person approves.
 *
 * **The host starts it, never the plugin's own process**, which Node's permission model keeps
 * from starting anything (ADR 0049), and never through a shell. The program lives as long as
 * the plugin keeps it: bytes go to its stdin and come back from stdout and stderr while it
 * runs, which is what a conversation over JSON-RPC on stdio needs (TYTO-569).
 *
 * This module holds the checks that do not depend on a disk: the name, the permission, the
 * number of live programs, the size of a write. Finding the program, the folder it runs in,
 * its environment and a restricted workspace are the adapter's, behind
 * {@link HostCapabilities.startProcess}, because only it can see the machine.
 */

/** The prefix of the permission that names a program: `process:<name>`. */
export const PROCESS_PERMISSION = 'process:';

/**
 * A program's name as a permission writes it: lowercase letters, digits, `.`, `_` and `-`,
 * starting with a letter or digit, at most 64 characters. Lowercase because Windows and macOS
 * ignore case in a file name and Linux does not: one spelling means one program everywhere.
 */
const PROGRAM_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

/**
 * An extension a program has on one system and not another. The host adds the one its system
 * runs (`claude.exe`, `claude.cmd`), so a permission written with one would name a program that
 * does not exist elsewhere, or, for `.ps1` and `.sh`, a script a shell would read.
 */
const SYSTEM_EXTENSION = /\.(?:exe|com|cmd|bat|ps1|sh)$/u;

/**
 * At most this many programs a plugin started are running at once (ADR 0182). Two: a
 * conversation with an agent is one, and a second lets the plugin start the next one before
 * the first has finished exiting. A plugin that needs more asks for a new ADR; the number is
 * meant to be revisited, not to be large.
 */
export const PLUGIN_PROCESS_LIMIT = 2;

/** The largest single write to a program's stdin, in bytes: one message, not a file. */
export const PROCESS_WRITE_LIMIT_BYTES = 1024 * 1024;

/**
 * What a stream keeps for a plugin that has not listened to it yet, in bytes. Past this, the
 * stream's next chunks are dropped until a listener arrives: a plugin that never reads stderr
 * must not grow the host's memory without bound.
 */
export const PROCESS_UNREAD_LIMIT_BYTES = 1024 * 1024;

/**
 * The variable that names the plugin's data folder to every program the host starts for it
 * (ADR 0187): an absolute path the host created, outside the plugin's own folder and its cache,
 * kept across the plugin's updates and deleted when it is removed. The plugin's own process
 * cannot reach it (ADR 0049); its program, which runs as the person, can. Set by the host, never
 * passed through from main's environment.
 */
export const PROGRAM_DATA_VARIABLE = 'TYTO_PROGRAM_DATA';

/** Why `name` is not a program a permission can name, or `undefined` when it is one. */
export function programNameProblem(name: string): string | undefined {
  if (name.includes('/') || name.includes('\\')) return 'is a path; name the program alone';
  if (name.includes('*')) return 'has a wildcard; name one program';
  if (!PROGRAM_NAME.test(name)) {
    return 'is not 1 to 64 lowercase letters, digits, dots, hyphens and underscores';
  }
  if (SYSTEM_EXTENSION.test(name)) return 'ends in an extension; name the program without it';
  return undefined;
}

/**
 * The plugin's own programs (ADR 0184): a manifest's `programs`, from a declared name to a script
 * inside the plugin's folder that the host runs on its bundled Node instead of looking the name
 * up on `PATH`.
 */
export type PluginProgramScripts = Readonly<Record<string, string>>;

/** A script's extension: what the bundled Node runs as a module or a script, nothing else. */
const SCRIPT_EXTENSION = /\.(?:mjs|cjs|js)$/u;

/** One segment of a script's path: no `.` or `..`, nothing a shell or a drive reads. */
const SCRIPT_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/u;

/**
 * Why `path` is not a script a manifest's `programs` can name, or `undefined` when it is one: a
 * relative path with forward slashes, inside the plugin's folder by its spelling alone, ending
 * in `.mjs`, `.cjs` or `.js`, at most 200 characters. The host confines it again on the disk,
 * after resolving links, because only it can see where the folder is (ADR 0184 decision 2).
 */
export function programScriptProblem(path: string): string | undefined {
  if (path.length === 0 || path.length > 200) return 'is not 1 to 200 characters';
  if (path.includes('\\')) return 'uses a backslash; separate folders with /';
  if (path.startsWith('/') || /^[A-Za-z]:/u.test(path))
    return 'is absolute; name it from the plugin folder';
  const segments = path.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return 'leaves the plugin folder or names . ; write the path from the plugin folder down';
  }
  if (!segments.every((segment) => SCRIPT_SEGMENT.test(segment))) {
    return 'has a folder or file name with characters other than letters, digits, ., _ and -';
  }
  if (!SCRIPT_EXTENSION.test(path)) return 'does not end in .mjs, .cjs or .js';
  return undefined;
}

/** The script a declared program runs, when the manifest names one; never an inherited key. */
export function programScript(scripts: PluginProgramScripts, name: string): string | undefined {
  return Object.hasOwn(scripts, name) ? scripts[name] : undefined;
}

/** `process:<name>`, exactly: a permission for `claude` does not start `claude-code`. */
export function allowsProcess(permissions: readonly string[], name: string): boolean {
  return (
    programNameProblem(name) === undefined && permissions.includes(`${PROCESS_PERMISSION}${name}`)
  );
}

/** How a program ended: its exit code, or the signal that ended it. */
export interface ProcessExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/** What a started program tells whoever started it. `exit` is called once, last. */
export interface ProcessEvents {
  stdout(bytes: Uint8Array): void;
  stderr(bytes: Uint8Array): void;
  exit(exit: ProcessExit): void;
}

/**
 * A program an adapter started (the port's answer). `kill` ends it and must be safe to call
 * on a program that already ended; the adapter still reports the exit through
 * {@link ProcessEvents.exit}.
 */
export interface StartedProcess {
  /**
   * The absolute folder the adapter started the program in: the open workspace, or the home
   * folder with none open. ACP's `session/new` needs it, and only the host knows it.
   */
  readonly cwd: string;
  write(bytes: Uint8Array): Promise<void>;
  /** Closes stdin, which is how a program reading it learns there is no more. */
  end(): Promise<void>;
  kill(): void;
}

/**
 * The port's signature, as {@link HostCapabilities.startProcess} declares it. `script` is the
 * plugin-relative path the manifest's `programs` names for `program` (ADR 0184), checked for its
 * spelling: the adapter runs it on the bundled Node from the plugin's folder rather than looking
 * `program` up on `PATH`. Undefined for a program the person installed.
 */
export type StartProcess = (
  plugin: string,
  program: string,
  args: readonly string[],
  events: ProcessEvents,
  script?: string,
) => Promise<StartedProcess>;

/** A program the plugin started, as the plugin holds it. */
export interface PluginProcess {
  /**
   * The absolute folder the host started it in (the open workspace, or the home folder with
   * none open), as ACP's `session/new` asks for its `cwd`.
   */
  readonly cwd: string;
  /** Bytes, or text sent as UTF-8, to its stdin; at most 1 MiB per write. */
  write(data: Uint8Array | string): Promise<void>;
  /** Closes its stdin. */
  end(): Promise<void>;
  /** Ends it. Resolves once asked; {@link exited} settles when it has ended. */
  kill(): Promise<void>;
  /**
   * Every chunk of stdout, as it arrives; returns the function that stops listening. Chunks
   * that came before the first listener are handed to it first, up to 1 MiB.
   */
  onStdout(listener: (bytes: Uint8Array) => void): () => void;
  /** The same, for stderr. */
  onStderr(listener: (bytes: Uint8Array) => void): () => void;
  /** Resolves when the program has ended, whoever ended it. */
  readonly exited: Promise<ProcessExit>;
}

/**
 * `host.process`: start a program the manifest names as `process:<name>` (ADR 0182).
 */
export interface HostProcess {
  /**
   * Starts the program named `name` with `args`, as an array: no shell reads them. Undeclared
   * is `E_PERMISSION`; a host that cannot start programs (the CLI) is `E_PROCESS_UNAVAILABLE`;
   * more than {@link PLUGIN_PROCESS_LIMIT} running is `E_PROCESS_LIMIT`; a program that is not
   * on `PATH` is `E_PROCESS_NOT_FOUND`; a restricted workspace is `E_PROCESS_RESTRICTED`; an
   * argument the host cannot pass safely is `E_PROCESS_ARGUMENT`.
   */
  start(name: string, args?: readonly string[]): Promise<PluginProcess>;
}

/** The `host.process` both sides of the isolation boundary hand a plugin. */
export function hostProcess(
  start: (name: string, args: readonly string[]) => Promise<PluginProcess>,
): HostProcess {
  return { start: (name, args = []) => start(name, args) };
}

/** The operations behind a {@link PluginProcess}, already checked. */
export interface ProcessOperations {
  /** Where the program runs, as the adapter reported it. */
  readonly cwd: string;
  write(bytes: Uint8Array): Promise<void>;
  end(): Promise<void>;
  kill(): Promise<void>;
}

/** One output stream, keeping what arrives before anybody listens. */
function outputStream(): {
  push(bytes: Uint8Array): void;
  listen(listener: (bytes: Uint8Array) => void): () => void;
} {
  const listeners = new Set<(bytes: Uint8Array) => void>();
  let unread: Uint8Array[] | undefined = [];
  let unreadBytes = 0;
  return {
    push(bytes) {
      if (unread !== undefined) {
        if (unreadBytes + bytes.length <= PROCESS_UNREAD_LIMIT_BYTES) {
          unread.push(bytes);
          unreadBytes += bytes.length;
        }
        return;
      }
      for (const listener of listeners) listener(bytes);
    },
    listen(listener) {
      listeners.add(listener);
      if (unread !== undefined) {
        const kept = unread;
        unread = undefined;
        for (const bytes of kept) listener(bytes);
      }
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The events a program reports and the handle a plugin holds, joined. The events may arrive
 * before the handle exists — across the isolation boundary the first chunk of stdout can be
 * read in the same tick as the answer to `start` — so they are kept until `handle` is called.
 */
export function processChannel(): {
  readonly events: ProcessEvents;
  handle(operations: ProcessOperations): PluginProcess;
} {
  const stdout = outputStream();
  const stderr = outputStream();
  let ended: ((exit: ProcessExit) => void) | undefined;
  const exited = new Promise<ProcessExit>((resolve) => {
    ended = resolve;
  });
  return {
    events: {
      stdout: (bytes) => stdout.push(bytes),
      stderr: (bytes) => stderr.push(bytes),
      exit: (exit) => ended?.(exit),
    },
    handle: (operations) => ({
      cwd: operations.cwd,
      write: (data) => operations.write(bytesOf(data)),
      end: () => operations.end(),
      kill: () => operations.kill(),
      onStdout: (listener) => stdout.listen(listener),
      onStderr: (listener) => stderr.listen(listener),
      exited,
    }),
  };
}

/** A started program behind the checks, as a host keeps it. */
export interface CheckedProcess extends ProcessOperations {
  readonly program: string;
}

/** Every program one plugin started through one host, and the checks in front of them. */
export interface CheckedProcesses {
  start(name: string, args: readonly string[], events: ProcessEvents): Promise<CheckedProcess>;
  /**
   * Ends every program still running, and any whose start has not answered yet: called when
   * the plugin stops, crashes or is closed, so nothing it started outlives it.
   */
  stopAll(): void;
}

function refuse(problem: ReturnType<typeof diagnostic>): Promise<never> {
  return Promise.reject(new PluginCapabilityError(problem));
}

/**
 * The checks in front of {@link HostCapabilities.startProcess}, for one plugin. Like
 * `checkedCapabilities`, the permissions are the manifest's as the host validated it, and the
 * check runs on the host's side of the boundary, never in the plugin's process.
 */
export function checkedProcesses(
  plugin: string,
  permissions: readonly string[],
  capabilities: HostCapabilities | undefined,
  scripts: PluginProgramScripts = {},
): CheckedProcesses {
  /** Running, or starting: a start counts against the limit before the adapter answers. */
  const live = new Set<{ stop(): void }>();

  return {
    async start(name, args, events) {
      if (typeof name !== 'string') throw new TypeError('a program name must be a string.');
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
        throw new TypeError('the arguments of a program must be an array of strings.');
      }
      if (!allowsProcess(permissions, name)) {
        return refuse(
          diagnostic('E_PERMISSION', {
            plugin,
            capability: `host.process.start('${name}') (${PROCESS_PERMISSION}${name})`,
          }),
        );
      }
      const host = capabilities?.hostName ?? 'this host';
      if (capabilities?.startProcess === undefined) {
        return refuse(diagnostic('E_PROCESS_UNAVAILABLE', { plugin, program: name, host }));
      }
      if (live.size >= PLUGIN_PROCESS_LIMIT) {
        return refuse(
          diagnostic('E_PROCESS_LIMIT', {
            plugin,
            program: name,
            limit: String(PLUGIN_PROCESS_LIMIT),
          }),
        );
      }

      let started: StartedProcess | undefined;
      let stopped = false;
      let exited = false;
      const slot = {
        stop() {
          stopped = true;
          started?.kill();
        },
      };
      live.add(slot);
      const watched: ProcessEvents = {
        stdout: (bytes) => events.stdout(bytes),
        stderr: (bytes) => events.stderr(bytes),
        exit: (exit) => {
          if (exited) return;
          exited = true;
          live.delete(slot);
          events.exit(exit);
        },
      };
      try {
        const script = programScript(scripts, name);
        started = await (script === undefined
          ? capabilities.startProcess(plugin, name, [...args], watched)
          : capabilities.startProcess(plugin, name, [...args], watched, script));
      } catch (cause) {
        live.delete(slot);
        throw cause;
      }
      // Stopped while the adapter was starting it: the plugin is gone, so the program goes too.
      if (stopped) started.kill();
      // Read as `unknown`: the adapter is typed, but this is the check that does not trust it.
      // A plugin hands this folder to its agent as ACP's absolute `cwd` (ADR 0182, 2026-11-09).
      const cwd: unknown = started.cwd;
      if (typeof cwd !== 'string' || cwd === '') {
        started.kill();
        throw new TypeError(`${host} started '${name}' without saying the folder it runs in.`);
      }

      const running = started;
      const gone = (): Promise<never> =>
        refuse(diagnostic('E_PROCESS_EXITED', { plugin, program: name }));
      return {
        program: name,
        cwd,
        write(bytes) {
          if (exited) return gone();
          if (bytes.length > PROCESS_WRITE_LIMIT_BYTES) {
            return Promise.reject(
              new RangeError(
                `a write to '${name}' is ${String(bytes.length)} bytes; the ceiling is ` +
                  `${String(PROCESS_WRITE_LIMIT_BYTES)}.`,
              ),
            );
          }
          return running.write(bytes);
        },
        end() {
          if (exited) return gone();
          return running.end();
        },
        kill() {
          running.kill();
          return Promise.resolve();
        },
      };
    },

    stopAll() {
      for (const slot of [...live]) slot.stop();
    },
  };
}
