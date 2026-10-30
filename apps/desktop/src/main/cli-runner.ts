import { extname, resolve } from 'node:path';

import {
  type CliEnvironment,
  type CommandDescription,
  type CommandInvocation,
  EXIT_INTERNAL,
  type ExitCode,
  type LocatedDiagnostic,
  commandTree,
  run as runCommand,
} from '@tyto/command-line';
import type { Rasterizer } from '@tyto/raster';

import { TAB_EXTENSIONS } from '../../shared/file-icons.js';

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
  /** The run's diagnostics as Problems rows, pushed as they are printed (decision 7). */
  readonly diagnostics?: (rows: CliDiagnostics) => void;
  /** `@tyto/command-line`'s `run`, injected so the runner is tested without a real command. */
  readonly run?: typeof runCommand;
  readonly newId?: () => string;
}

/** One push of `cli:diagnostics`: the rows a run printed, under the command it ran. */
export interface CliDiagnostics {
  readonly runId: string;
  readonly label: string;
  readonly diagnostics: readonly CliDiagnosticRow[];
}

export interface CliDiagnosticRow {
  /** What `cli:open-diagnostic` takes back: main keeps the path, the window never names it. */
  readonly index: number;
  readonly severity: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  /** The file as the text printed it, relative to the run's folder where it could be. */
  readonly where?: string;
  readonly line?: number;
  readonly column?: number;
  readonly hint?: string;
  /** Whether a tab opens the file: a brief, a text file or a recipe (`TAB_EXTENSIONS`). */
  readonly openable: boolean;
}

/** The runs whose rows a click can still open; the panel shows the same last five. */
export const KEPT_RUNS = 5;

const opensInATab = (path: string): boolean =>
  (TAB_EXTENSIONS as readonly string[]).includes(extname(path).toLowerCase());

const SEVERITIES = new Set(['error', 'warning', 'info']);

export interface CliRunner {
  start(argv: readonly string[]): { readonly runId: string };
  /** Fires the run's signal. Unknown or finished ids are ignored: Stop raced the end. */
  cancel(runId: string): void;
  /** Every running command, stopped: the app quits or the window opens another folder. */
  cancelAll(): void;
  commands(): CommandDescription;
  /** The file a run's Problems row names, while the run is one of the last {@link KEPT_RUNS}. */
  diagnosticPath(runId: string, index: number): string | undefined;
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
  // Insertion order is the runs' order, so the first key is the oldest to let go.
  const paths = new Map<string, (string | undefined)[]>();

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
        diagnostics: (items: readonly LocatedDiagnostic[]) => {
          const report = options.diagnostics;
          if (report === undefined) return;
          let kept = paths.get(runId);
          if (kept === undefined) {
            kept = [];
            paths.set(runId, kept);
            const oldest = paths.keys().next().value;
            if (paths.size > KEPT_RUNS && oldest !== undefined) paths.delete(oldest);
          }
          const rows: CliDiagnosticRow[] = [];
          for (const item of items) {
            const path = item.path === undefined ? undefined : resolve(base.cwd, item.path);
            rows.push({
              index: kept.length,
              severity: SEVERITIES.has(item.severity)
                ? (item.severity as CliDiagnosticRow['severity'])
                : 'error',
              code: item.code,
              message: item.message,
              ...(item.path === undefined ? {} : { where: item.path }),
              ...(item.line === undefined ? {} : { line: item.line }),
              ...(item.column === undefined ? {} : { column: item.column }),
              ...(item.hint === undefined ? {} : { hint: item.hint }),
              openable: path !== undefined && opensInATab(path),
            });
            kept.push(path);
          }
          report({ runId, label: ['tyto', ...argv].join(' '), diagnostics: rows });
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
    diagnosticPath: (runId, index) => paths.get(runId)?.[index],
  };
}

/**
 * The window's rasterizer: the one the plugin registry holds, the hidden-window adapter the app
 * registered under `chromium` (ADR 0007, ADR 0027). The export and every `tyto` command take
 * it from here, so a capture from either queues on the same adapter (ADR 0159 decision 3).
 */
export function registeredRasterizer(registry: {
  rasterizers<T>(): readonly { readonly value: T }[];
}): Rasterizer | undefined {
  return registry.rasterizers<Rasterizer>()[0]?.value;
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
