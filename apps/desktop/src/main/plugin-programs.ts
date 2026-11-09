import { posix, win32 } from 'node:path';

import { WINDOW_PID_VARIABLE } from '@tyto/command-line/relay';
import { diagnostic } from '@tyto/core';
import {
  PluginCapabilityError,
  type ProcessEvents,
  type StartProcess,
  type StartedProcess,
} from '@tyto/plugin-api';

import type { WorkspaceState } from './workspace.js';

/**
 * The programs a plugin starts through `process:<name>`, for the desktop (TYTO-568, ADR 0182
 * decision 8).
 *
 * `checkedProcesses` in `@tyto/plugin-api` has already checked the permission and the limit when
 * a start reaches this module. What is left needs the machine: the open folder and its trust, the
 * program's file on `PATH`, an environment with no secret in it, and, on Windows, `cmd.exe` for
 * an npm `.cmd` shim. **No shell anywhere else**: an `.exe` and a POSIX program are started with
 * their arguments as an array.
 *
 * Pure but for `spawn` and `killTree`, which are handed in with the platform, the environment
 * and the file check, so the Windows rules are tested on Linux CI and the other way round, as
 * `terminal-agent.ts` is.
 */

/** What this module asks of a child process: Node's `ChildProcess`, as far as it is used. */
export interface ProgramChild {
  readonly pid?: number | undefined;
  readonly stdin: {
    write(bytes: Uint8Array, done: (error?: Error | null) => void): unknown;
    end(done?: () => void): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
  };
  readonly stdout: { on(event: 'data', listener: (chunk: Uint8Array) => void): unknown };
  readonly stderr: { on(event: 'data', listener: (chunk: Uint8Array) => void): unknown };
  once(event: 'spawn', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown;
}

export interface ProgramSpawnOptions {
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly stdio: readonly ['pipe', 'pipe', 'pipe'];
  readonly windowsHide: true;
  /** Set for `cmd.exe` alone, whose command line is built here, quoted, already. */
  readonly windowsVerbatimArguments?: true;
  /** POSIX: its own process group, so ending it ends what it started. */
  readonly detached?: true;
}

export interface PluginProgramsOptions {
  readonly platform: NodeJS.Platform;
  /** Main's environment, read at each start. */
  readonly environment: () => Readonly<Record<string, string | undefined>>;
  readonly exists: (path: string) => boolean;
  /** The folder open in the window and its trust, read at each start and at each `settle`. */
  readonly workspace: () => Pick<WorkspaceState, 'folder' | 'trust'>;
  /** Where a program runs when no folder is open. */
  readonly home: string;
  /** The window's process id: what `TYTO_WINDOW` names (ADR 0181 decision 3). */
  readonly windowPid: number;
  readonly spawn: (
    file: string,
    args: readonly string[],
    options: ProgramSpawnOptions,
  ) => ProgramChild;
  /**
   * Ends the program and every process it started: `taskkill /T` on Windows, the group elsewhere.
   * `now` is the window closing or the app quitting, when main may be gone before an
   * asynchronous `taskkill` runs: the kill then finishes before this returns.
   */
  readonly killTree: (child: ProgramChild, now: boolean) => void;
}

export interface PluginPrograms {
  readonly startProcess: StartProcess;
  /**
   * Ends every program started for a folder or a trust that is no longer the one open (ADR 0182
   * decision 8): called after the workspace opens, closes, or is trusted or distrusted.
   */
  settle(): void;
  /** Ends every program: the window closed, or the app quits. */
  stopAll(): void;
}

/** What `cmd.exe` reads on Windows when `PATHEXT` is missing. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** The extensions Tyto starts, in the order it prefers them: a binary before a script. */
const RUNNABLE = ['.exe', '.com', '.cmd', '.bat'] as const;

/** A `.cmd` or `.bat` is a script only `cmd.exe` runs. */
const isBatch = (file: string): boolean => /\.(?:cmd|bat)$/iu.test(file);

function variable(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  // Windows spells it `Path`, and a process environment there is case-insensitive.
  return Object.entries(environment).find(([key]) => key.toUpperCase() === name)?.[1];
}

/**
 * The program's file: the first `PATH` folder that has it. On Windows only with an extension
 * `PATHEXT` names and Tyto runs — `.exe` and `.com` before `.cmd` and `.bat`, never `.ps1` and
 * never the extensionless POSIX script npm writes beside its shims. Undefined when nothing has it.
 */
export function findPluginProgram(
  options: Pick<PluginProgramsOptions, 'platform' | 'exists'> & {
    readonly environment: Readonly<Record<string, string | undefined>>;
  },
  name: string,
): string | undefined {
  const windows = options.platform === 'win32';
  const path = windows ? win32 : posix;
  const allowed = new Set(
    (variable(options.environment, 'PATHEXT') ?? DEFAULT_PATHEXT)
      .split(';')
      .map((extension) => extension.toLowerCase()),
  );
  const names = windows
    ? RUNNABLE.filter((extension) => allowed.has(extension)).map(
        (extension) => `${name}${extension}`,
      )
    : [name];
  for (const folder of (variable(options.environment, 'PATH') ?? '').split(path.delimiter)) {
    if (folder === '' || !path.isAbsolute(folder)) continue;
    for (const candidate of names) {
      const file = path.join(folder, candidate);
      if (options.exists(file)) return file;
    }
  }
  return undefined;
}

/** Names an environment keeps, upper-cased (ADR 0182 decision 8). */
const KEPT = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'USER',
  'USERNAME',
  'LOGNAME',
  'LANG',
  'LANGUAGE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'HOMEDRIVE',
  'HOMEPATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
]);

/**
 * A name shaped like a secret. Dropped even when the list above would keep it, so a later change
 * to the list cannot hand a plugin's program an API key: an agent that needs one uses its login.
 */
const SECRET_SHAPED = /(?:^|_)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)$/u;

/**
 * The program's environment: the allowlist out of main's, and `TYTO_WINDOW`. Never
 * `TYTO_PLUGIN_*`, `ELECTRON_*`, `NODE_OPTIONS` or a variable shaped like a secret.
 */
export function programEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  windowPid: number,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (SECRET_SHAPED.test(upper)) continue;
    if (KEPT.has(upper) || upper.startsWith('LC_')) kept[key] = value;
  }
  return { ...kept, [WINDOW_PID_VARIABLE]: String(windowPid) };
}

/**
 * What `cmd.exe` gives a meaning of its own, even between quotes (`%`, `!`) or outside them, and
 * a line break, which ends its command. Refused rather than escaped (ADR 0181 decision 5).
 */
const BATCH_UNSAFE = /["%^&|<>()!\r\n]/u;

/** Why `value` cannot ride a `cmd.exe` command line, or `undefined` when it can. */
export function batchArgumentProblem(value: string): string | undefined {
  const found = BATCH_UNSAFE.exec(value)?.[0];
  if (found === undefined) return undefined;
  const shown =
    found === '\r' ? 'a carriage return' : found === '\n' ? 'a line break' : `'${found}'`;
  return `an argument holds ${shown}, which cmd.exe reads as its own, and a .cmd program is started through it`;
}

/** One argument on a `cmd.exe` line: quoted when it has a space or is empty, as Windows splits. */
const quoted = (value: string): string =>
  value === '' || /[\s]/u.test(value) ? `"${value}"` : value;

/**
 * How a `.cmd` is started: `cmd.exe /d /s /c "<"shim"> args>"`. `/d` skips AutoRun, `/s` strips
 * exactly the outer quotes, and the shim's path is quoted so a folder with a space is one word.
 * The path itself may hold a parenthesis (`Program Files (x86)`), which is literal inside quotes,
 * but not `%` or `"`, which are not.
 */
export function batchCommand(
  environment: Readonly<Record<string, string | undefined>>,
  file: string,
  args: readonly string[],
): { readonly file: string; readonly args: readonly string[] } | { readonly problem: string } {
  if (/["%]/u.test(file)) {
    return {
      problem: `its path holds a quote or a percent sign, which cmd.exe would read: ${file}`,
    };
  }
  for (const arg of args) {
    const problem = batchArgumentProblem(arg);
    if (problem !== undefined) return { problem };
  }
  const root = variable(environment, 'SYSTEMROOT') ?? 'C:\\Windows';
  const line = [`"${file}"`, ...args.map(quoted)].join(' ');
  return { file: win32.join(root, 'System32', 'cmd.exe'), args: ['/d', '/s', '/c', `"${line}"`] };
}

function refusal(
  code: Parameters<typeof diagnostic>[0],
  parameters: Record<string, string>,
): Error {
  return new PluginCapabilityError(diagnostic(code, parameters));
}

/** The desktop's `startProcess` port and the lifetime around it. */
export function pluginPrograms(options: PluginProgramsOptions): PluginPrograms {
  /** Each running program, with the folder and trust it was started for. */
  const running = new Map<ProgramChild, string>();
  const placeOf = (): string => {
    const { folder, trust } = options.workspace();
    return `${String(folder)}\u0000${String(trust)}`;
  };
  const end = (child: ProgramChild, now = false): void => {
    if (!running.delete(child)) return;
    options.killTree(child, now);
  };

  const startProcess: StartProcess = async (plugin, program, args, events: ProcessEvents) => {
    const { folder, trust } = options.workspace();
    // Before the program is even looked for, as the terminal is refused (ADR 0164 decision 5).
    if (folder !== null && trust === 'restricted') {
      throw refusal('E_PROCESS_RESTRICTED', { plugin, program });
    }
    const environment = options.environment();
    const file = findPluginProgram({ ...options, environment }, program);
    if (file === undefined) throw refusal('E_PROCESS_NOT_FOUND', { plugin, program });

    const env = programEnvironment(environment, options.windowPid);
    const base = {
      cwd: folder ?? options.home,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    } as const;
    let child: ProgramChild;
    if (options.platform === 'win32' && isBatch(file)) {
      const command = batchCommand(environment, file, args);
      if ('problem' in command) {
        throw refusal('E_PROCESS_ARGUMENT', { plugin, program, problem: command.problem });
      }
      child = options.spawn(command.file, command.args, {
        ...base,
        windowsVerbatimArguments: true,
      });
    } else {
      child = options.spawn(
        file,
        args,
        options.platform === 'win32' ? base : { ...base, detached: true },
      );
    }

    // Listened to for the program's whole life: an `error` nobody hears ends main's process.
    let failed: ((error: Error) => void) | undefined;
    child.on('error', (error) => failed?.(error));
    await new Promise<void>((resolve, reject) => {
      failed = reject;
      child.once('spawn', () => {
        failed = undefined;
        resolve();
      });
    });
    running.set(child, placeOf());
    // A program that stopped reading its stdin answers the next write with EPIPE; that write
    // rejects, and the error must not reach main's process as an unhandled event.
    child.stdin.on('error', () => undefined);
    child.stdout.on('data', (chunk) => events.stdout(new Uint8Array(chunk)));
    child.stderr.on('data', (chunk) => events.stderr(new Uint8Array(chunk)));
    // `close`, not `exit`: every byte of stdout has been read by then.
    child.once('close', (code, signal) => {
      running.delete(child);
      events.exit({ code, signal });
    });

    const started: StartedProcess = {
      write: (bytes) =>
        new Promise((resolve, reject) => {
          child.stdin.write(bytes, (error) => (error ? reject(error) : resolve()));
        }),
      end: () =>
        new Promise((resolve) => {
          child.stdin.end(resolve);
        }),
      kill: () => end(child),
    };
    return started;
  };

  return {
    startProcess,
    settle() {
      const now = placeOf();
      for (const [child, place] of [...running]) if (place !== now) end(child);
    },
    stopAll() {
      for (const child of [...running.keys()]) end(child, true);
    },
  };
}

/**
 * Ends `child` and what it started. On Windows `taskkill /T`, because a `.cmd` runs under
 * `cmd.exe` and the program it starts is that shell's child, which `child.kill()` would leave
 * running. Elsewhere the process group the program leads, because it was started detached.
 */
export function killProgramTree(
  platform: NodeJS.Platform,
  child: Pick<ProgramChild, 'pid'>,
  how: {
    readonly run: (file: string, args: readonly string[]) => void;
    readonly signalGroup: (pid: number) => void;
  },
): void {
  const { pid } = child;
  if (pid === undefined) return;
  if (platform === 'win32') {
    how.run('taskkill', ['/pid', String(pid), '/T', '/F']);
    return;
  }
  try {
    how.signalGroup(pid);
  } catch {
    // The group is gone already: the program ended on its own.
  }
}
