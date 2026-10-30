import {
  type CliEnvironment,
  type CommandDescription,
  type CommandInvocation,
  EXIT_INTERNAL,
  type ExitCode,
  commandTree,
  run as runCommand,
} from '@tyto/command-line';

/**
 * `tyto` commands run in main, in-process, for the window (ADR 0159, TYTO-495).
 *
 * Each run gets an id, its own `AbortController` and an environment built from the window's
 * own instances: the rasterizer the export uses, the bundled-Node launcher, the window's
 * `TYTO_HOME` and the open folder as `cwd`. What a command prints is pushed as it is printed,
 * on `cli:output`; where a run stands is pushed on `cli:state`. Nothing comes back from the
 * renderer but `cli:run` and `cli:cancel`: a question a command asks is a native box main
 * shows (decision 4), never a page the renderer could answer.
 */

export type CliRunState = 'running' | 'waiting' | 'finished' | 'cancelled';

export interface CliOutput {
  readonly runId: string;
  readonly stream: 'out' | 'err';
  readonly text: string;
}

export interface CliStateChange {
  readonly runId: string;
  readonly state: CliRunState;
  readonly code?: number;
  readonly question?: string;
}

/** What a run's environment holds that the runner does not supply itself. */
export type CliBaseEnvironment = Omit<CliEnvironment, 'console' | 'confirm' | 'refuse'>;

export interface CliRunnerOptions {
  /** A fresh base for each run, so a run started after Open Folder sees the new folder. */
  readonly environment: () => CliBaseEnvironment;
  /** The window's refusals (`cli-refusals.ts`), asked with the run's `cwd`. */
  readonly refuse: (invocation: CommandInvocation, cwd: string) => Promise<string | undefined>;
  /** A native yes-or-no box, no being the default and what Escape answers. */
  readonly confirm: (question: string) => Promise<boolean>;
  readonly output: (output: CliOutput) => void;
  readonly state: (change: CliStateChange) => void;
  /** What the window refreshes after a command with a window twin (decision 3). */
  readonly afterRun?: (path: readonly string[], code: ExitCode) => Promise<void> | void;
  /** `@tyto/command-line`'s `run`, injected so the runner is tested without a real command. */
  readonly run?: typeof runCommand;
  readonly newId?: () => string;
}

export interface CliRunner {
  start(argv: readonly string[]): { readonly runId: string };
  /** Fires the run's signal. Unknown or finished ids are ignored: Stop raced the end. */
  cancel(runId: string): void;
  /** Every running command, stopped: the app quits or the window opens another folder. */
  cancelAll(): void;
  commands(): CommandDescription;
}

/** The two commands that stop part of the way through (decision 6); the rest run to their end. */
const STOPPABLE = new Set(['render', 'watch']);

/** Installed plugins start once for the app's life (ADR 0044), so a change waits for a restart. */
const RESTART_COMMANDS = new Set(['install', 'remove', 'enable', 'disable']);

export const RESTART_NOTE =
  'The window starts its installed plugins once, at launch (ADR 0044): restart Tyto to use this change.\n';

export const STILL_FINISHING =
  'This command does not stop part of the way through: it is finishing what it started.\n';

let counter = 0;
const nextId = (): string => `cli-${String((counter += 1))}`;

export function createCliRunner(options: CliRunnerOptions): CliRunner {
  const running = new Map<
    string,
    { readonly controller: AbortController; path: readonly string[] }
  >();
  const run = options.run ?? runCommand;
  const newId = options.newId ?? nextId;

  const cancel = (runId: string): void => {
    const entry = running.get(runId);
    if (entry === undefined || entry.controller.signal.aborted) return;
    entry.controller.abort();
    // At once, whatever the command does next: the panel never waits on a command to agree
    // that it was stopped. A command that takes no signal says that it is still finishing.
    options.state({ runId, state: 'cancelled' });
    if (!STOPPABLE.has(entry.path[0] ?? '')) {
      options.output({ runId, stream: 'err', text: STILL_FINISHING });
    }
  };

  return {
    start(argv) {
      const runId = newId();
      const controller = new AbortController();
      const entry: { readonly controller: AbortController; path: readonly string[] } = {
        controller,
        path: [],
      };
      running.set(runId, entry);
      const base = options.environment();
      const write = (stream: 'out' | 'err') => (text: string) => {
        options.output({ runId, stream, text });
      };
      const environment: CliEnvironment = {
        ...base,
        console: { out: write('out'), err: write('err') },
        confirm: async (question) => {
          options.state({ runId, state: 'waiting', question });
          const answer = await options.confirm(question);
          if (!controller.signal.aborted) options.state({ runId, state: 'running' });
          return answer;
        },
        refuse: (invocation) => {
          entry.path = invocation.path;
          return options.refuse(invocation, base.cwd);
        },
      };

      options.state({ runId, state: 'running' });
      void run(argv, environment, controller.signal)
        .catch((cause: unknown): ExitCode => {
          // `run` turns every throw it awaits into exit 2; this is the one it cannot.
          write('err')(`tyto: internal failure — ${String(cause)}\n`);
          return EXIT_INTERNAL;
        })
        .then(async (code) => {
          running.delete(runId);
          const [command, subcommand] = entry.path;
          if (code === 0 && command === 'plugin' && RESTART_COMMANDS.has(subcommand ?? '')) {
            write('err')(RESTART_NOTE);
          }
          // A cancelled run already said so; its code would be a second, contradicting answer.
          if (!controller.signal.aborted) options.state({ runId, state: 'finished', code });
          await options.afterRun?.(entry.path, code);
        });
      return { runId };
    },
    cancel,
    cancelAll() {
      for (const runId of [...running.keys()]) cancel(runId);
    },
    commands: () => commandTree({ ...options.environment(), console: { out() {}, err() {} } }),
  };
}

/**
 * The box `environment.confirm` shows (ADR 0159 decision 4): the question, and no as the
 * default and what Escape answers, as `[y/N]` is at a terminal. `show` is Electron's
 * `dialog.showMessageBox`, so the rule is tested without a window.
 */
export function confirmInABox(
  show: (box: {
    readonly type: 'question';
    readonly message: string;
    readonly buttons: readonly string[];
    readonly defaultId: number;
    readonly cancelId: number;
  }) => Promise<{ readonly response: number }>,
  text: (key: 'cli.confirm.yes' | 'cli.confirm.no') => string,
): (question: string) => Promise<boolean> {
  return async (question) => {
    const answer = await show({
      type: 'question',
      message: question.trim(),
      buttons: [text('cli.confirm.yes'), text('cli.confirm.no')],
      defaultId: 1,
      cancelId: 1,
    });
    return answer.response === 0;
  };
}
