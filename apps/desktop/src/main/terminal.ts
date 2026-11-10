import type { AgentLaunch } from './terminal-agent.js';
import type { ShellChoice } from './terminal-shell.js';

/**
 * The terminals, owned by main (TYTO-497, ADR 0164). The window draws what a terminal prints
 * and sends what the person types; it never names the program, the folder or the environment,
 * which are all chosen here.
 *
 * A terminal lives here and not in the window, so it survives a workspace change (it keeps the
 * folder it started in) and a reload (the window asks `list` and draws each `replay` again). It
 * ends when its tab closes, when its shell exits, or when the app quits.
 */

/** The part of node-pty's `IPty` used here: the seam tests replace (no real shell in a unit test). */
export interface PseudoTerminal {
  readonly pid: number;
  /**
   * The foreground program's name on macOS and Linux. On Windows node-pty answers the `name`
   * option it was spawned with (`xterm-256color`), measured, so it says nothing there.
   */
  readonly process: string;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
}

export interface SpawnOptions {
  readonly cols: number;
  readonly rows: number;
  readonly cwd: string;
  readonly env: Record<string, string>;
}

export interface TerminalDependencies {
  readonly spawn: (file: string, args: readonly string[], options: SpawnOptions) => PseudoTerminal;
  /** Read at each open, so a save of `terminalShell` applies to the next terminal. */
  readonly shell: () => ShellChoice;
  /**
   * What **Open an Agent Here** starts (TYTO-567, ADR 0181), or why nothing does. Read at each
   * open, as `shell` is; a configuration it names is written before the program starts.
   */
  readonly agent: () => AgentLaunch;
  /** Writes the agent's configuration file, in `TYTO_HOME`, never in the workspace. */
  readonly writeConfig: (file: string, text: string) => void;
  /** The open workspace folder, or `null` with none open. */
  readonly folder: () => string | null;
  readonly home: () => string;
  /** Whether the open workspace is restricted (ADR 0111): main refuses, not the hidden tab. */
  readonly restricted: () => boolean;
  readonly environment: () => Record<string, string>;
  readonly output: (terminalId: string, data: string) => void;
  readonly exit: (terminalId: string, code: number) => void;
  /** Ends the shell and every process it started; `pty.kill()` alone where that already does. */
  readonly killTree: (pty: PseudoTerminal) => void;
  /**
   * Whether `process` names the program in front: `false` on Windows, where the quit question
   * then never asks, rather than asking about every idle shell.
   */
  readonly foregroundKnown: boolean;
  /** Runs `flush` about one frame later: output is batched to one event per frame per terminal. */
  readonly schedule?: (flush: () => void) => void;
  /** The cap on `replay`, in UTF-8 bytes; 256 KiB unless a test asks for less. */
  readonly replayBytes?: number;
}

export const REPLAY_BYTES = 256 * 1024;

export const TERMINAL_RESTRICTED =
  'This folder is restricted, and a terminal started in it would run its files before anybody ' +
  'typed a command (ADR 0164). Trust the folder to open a terminal.';

export type TerminalOpened =
  | { readonly terminalId: string; readonly title: string }
  | { readonly refused: 'restricted' | 'failed'; readonly message: string };

/** A program main starts in a tab of its own (ADR 0184), with everything already chosen. */
export interface ProgramLaunch {
  readonly title: string;
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalListing {
  readonly terminalId: string;
  readonly title: string;
  readonly replay: string;
}

export interface Terminals {
  /** A shell, or with `agent` the agent program `agentCommand` names (TYTO-567). */
  open(size: {
    readonly cols: number;
    readonly rows: number;
    readonly agent?: boolean | undefined;
  }): TerminalOpened;
  input(terminalId: string, data: string): void;
  resize(terminalId: string, cols: number, rows: number): void;
  kill(terminalId: string): void;
  list(): readonly TerminalListing[];
  /**
   * A tab main opens itself, running a program a plugin declares (ADR 0184 decision 6): the
   * file, arguments, folder and environment were chosen and checked by the caller in main, never
   * by the renderer. `closed` settles when the program ends or the tab is closed or killed. The
   * window learns of it through `terminal:list`, as after a reload.
   */
  openProgram(launch: ProgramLaunch): TerminalOpened & { readonly closed?: Promise<void> };
  /** The titles of the terminals whose shell is running another program: the quit question. */
  busy(): readonly string[];
  killAll(): void;
}

interface Running {
  readonly pty: PseudoTerminal;
  readonly title: string;
  /** The shell's program name, to tell a program it started apart from it. */
  readonly shellName: string;
  readonly replay: { chunks: string[]; sizes: number[]; bytes: number };
  pending: string;
  scheduled: boolean;
  /** Settles `closed` for a tab main opened for a plugin; called once, whichever end comes. */
  readonly close: () => void;
}

/**
 * A program's bare name, as node-pty reports it on each platform: a path or not, `.exe` on
 * Windows, a leading `-` for a login shell on macOS. Compared against the shell's file and not
 * against the first reading, which on Linux can still be Electron's name before the `exec`.
 */
export function programName(file: string): string {
  const name = file.split(/[\\/]/u).pop() ?? file;
  return name
    .replace(/\.exe$/iu, '')
    .replace(/^-/u, '')
    .toLowerCase();
}

const frame = (flush: () => void): void => {
  setTimeout(flush, 16);
};

/** The UTF-8 size, without a `Buffer`: a code unit over 0x7FF is 3 bytes, a surrogate pair 4. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Keeps the newest output under the cap, dropping whole chunks from the front. A chunk is one
 * read off the PTY, a few KiB at most, so the replay is at most one chunk short of the cap.
 */
function remember(replay: Running['replay'], data: string, cap: number): void {
  const size = utf8Bytes(data);
  replay.chunks.push(data);
  replay.sizes.push(size);
  replay.bytes += size;
  while (replay.bytes > cap && replay.chunks.length > 0) {
    replay.chunks.shift();
    replay.bytes -= replay.sizes.shift() ?? 0;
  }
}

export function createTerminals(dependencies: TerminalDependencies): Terminals {
  const running = new Map<string, Running>();
  const schedule = dependencies.schedule ?? frame;
  const cap = dependencies.replayBytes ?? REPLAY_BYTES;
  let next = 1;

  const flush = (terminalId: string): void => {
    const terminal = running.get(terminalId);
    if (terminal === undefined) return;
    terminal.scheduled = false;
    const data = terminal.pending;
    terminal.pending = '';
    if (data !== '') dependencies.output(terminalId, data);
  };

  const start = (
    shell: Pick<ShellChoice, 'file' | 'args' | 'title'>,
    options: SpawnOptions,
    close: () => void = () => undefined,
  ): TerminalOpened => {
    let pty: PseudoTerminal;
    try {
      pty = dependencies.spawn(shell.file, shell.args, options);
    } catch (error) {
      return {
        refused: 'failed',
        message: `${shell.title} did not start: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const terminalId = `terminal-${String(next++)}`;
    const terminal: Running = {
      pty,
      title: shell.title,
      shellName: programName(shell.file),
      replay: { chunks: [], sizes: [], bytes: 0 },
      pending: '',
      scheduled: false,
      close,
    };
    running.set(terminalId, terminal);
    pty.onData((data) => {
      remember(terminal.replay, data, cap);
      terminal.pending += data;
      if (terminal.scheduled) return;
      terminal.scheduled = true;
      schedule(() => {
        flush(terminalId);
      });
    });
    pty.onExit(({ exitCode }) => {
      // A terminal main ended itself, from its tab or on the way out, is already forgotten and
      // nobody waits for its exit. On Linux that exit can arrive after the window is gone
      // during a quit, measured on CI, where reporting it crashed main.
      if (running.get(terminalId) !== terminal) return;
      // What the shell printed last reaches the window before the exit does.
      flush(terminalId);
      running.delete(terminalId);
      terminal.close();
      dependencies.exit(terminalId, exitCode);
    });
    return { terminalId, title: shell.title };
  };

  return {
    open: ({ cols, rows, agent = false }) => {
      // Before the agent is looked for: an agent is a program started in the folder, as a
      // shell is, and the folder's files reach it the same way (ADR 0164 decision 5).
      if (dependencies.restricted()) return { refused: 'restricted', message: TERMINAL_RESTRICTED };
      let shell: ShellChoice;
      if (agent) {
        const launch = dependencies.agent();
        if ('refused' in launch) return { refused: 'failed', message: launch.refused };
        shell = launch.choice;
        try {
          if (launch.config !== undefined) {
            dependencies.writeConfig(launch.config.file, launch.config.text);
          }
        } catch (error) {
          return {
            refused: 'failed',
            message: `${shell.title} did not start: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      } else {
        shell = dependencies.shell();
      }
      return start(shell, {
        cols,
        rows,
        cwd: dependencies.folder() ?? dependencies.home(),
        env: dependencies.environment(),
      });
    },

    openProgram: (launch) => {
      let close: () => void = () => undefined;
      const closed = new Promise<void>((resolve) => {
        close = resolve;
      });
      const opened = start(
        { file: launch.file, args: launch.args, title: launch.title },
        { cols: launch.cols, rows: launch.rows, cwd: launch.cwd, env: launch.env },
        close,
      );
      return 'refused' in opened ? opened : { ...opened, closed };
    },

    input: (terminalId, data) => {
      running.get(terminalId)?.pty.write(data);
    },

    resize: (terminalId, cols, rows) => {
      running.get(terminalId)?.pty.resize(cols, rows);
    },

    kill: (terminalId) => {
      const terminal = running.get(terminalId);
      if (terminal === undefined) return;
      running.delete(terminalId);
      terminal.close();
      dependencies.killTree(terminal.pty);
    },

    list: () =>
      [...running].map(([terminalId, terminal]) => ({
        terminalId,
        title: terminal.title,
        replay: terminal.replay.chunks.join(''),
      })),

    busy: () =>
      !dependencies.foregroundKnown
        ? []
        : [...running.values()]
            .filter((terminal) => programName(terminal.pty.process) !== terminal.shellName)
            .map((terminal) => terminal.title),

    killAll: () => {
      const all = [...running.values()];
      running.clear();
      for (const terminal of all) {
        terminal.close();
        dependencies.killTree(terminal.pty);
      }
    },
  };
}

/**
 * The process tree, ended. On macOS and Linux the shell leads its own process group (node-pty
 * starts it with `setsid`), so the group is sent `SIGHUP`, a hung-up terminal, before the shell
 * itself is killed.
 *
 * **On Windows node-pty's own `kill` is never called.** It lists the console's processes by
 * `child_process.fork`, and with the `runAsNode` fuse off (ADR 0067) that fork starts a second
 * Tyto rather than a Node: measured on `desktop.yml`'s Windows leg, where the packaged app stopped
 * answering after the first `terminal:kill`. So the shell's tree is ended by `endTree`
 * (`taskkill /T /F`), and node-pty then cleans up the way it does for a shell that exited.
 */
export function killTree(
  platform: NodeJS.Platform,
  signal: (pid: number) => void,
  endTree: (pid: number) => void,
) {
  return (pty: PseudoTerminal): void => {
    if (platform === 'win32') {
      try {
        endTree(pty.pid);
      } catch {
        // Already gone.
      }
      return;
    }
    try {
      signal(-pty.pid);
    } catch {
      // The group may already be gone; the shell's own kill below still runs.
    }
    try {
      pty.kill();
    } catch {
      // Already exited.
    }
  };
}

/**
 * Whether the app may quit over the terminals (ADR 0164 decision 6): at once when no terminal is
 * running a program, otherwise when the person says so. Once said, it stays said, because two
 * hooks fire for one click (the X button's `close`, then `before-quit`) and one box is enough.
 */
export function terminalQuitGuard(
  busy: () => readonly string[],
  ask: (titles: readonly string[]) => boolean,
): () => boolean {
  let granted = false;
  return () => {
    if (granted) return true;
    const titles = busy();
    if (titles.length === 0) return true;
    granted = ask(titles);
    return granted;
  };
}
