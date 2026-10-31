import type { IpcEventPayload } from '../../shared/ipc.js';
import { type AnsiState, freshAnsiState } from './ansi.js';
import { EMPTY_SCROLLBACK, type Scrollback, withNote, withOutput } from './command-output.js';
import type { CommandProblemRow } from './problems-panel.js';

/**
 * The command panel's sessions (TYTO-496): the tabs, each with its scrollback and at most one
 * run, and which tab is in front.
 *
 * **Held outside the panel's element**, because the element is removed whenever the panel is
 * closed (`dock.ts`) and a `watch` keeps printing while nobody looks. `main.ts` keeps one of
 * these for the window's life and feeds it every `cli:*` event; the element draws it.
 */

type CliOutput = IpcEventPayload<'cli:output'>;
type CliState = IpcEventPayload<'cli:state'>;
type CliDiagnostics = IpcEventPayload<'cli:diagnostics'>;

export type SessionState = 'idle' | CliState['state'];

export interface CommandSession {
  readonly id: string;
  /** Counted from 1 for the window's life, so a closed tab's number is not reused. */
  readonly number: number;
  /** The line last run here, as typed. */
  readonly line?: string;
  /** Its words, which a finished `trust` command is recognised by. */
  readonly words?: readonly string[];
  readonly runId?: string;
  readonly state: SessionState;
  /** The CLI's exit code once `finished`; none for `cancelled` (ADR 0159 decision 6). */
  readonly code?: number;
  /** What a native box is asking while `waiting`. */
  readonly question?: string;
  readonly scrollback: Scrollback;
  /** The rows the current run reported, which its output's places link to. */
  readonly diagnostics: readonly CommandProblemRow[];
}

/** A run that is going: Stop applies, and the tab may not start another. */
export const isBusy = (session: CommandSession): boolean =>
  session.state === 'running' || session.state === 'waiting';

/**
 * Whether the window asks for the open folder again after this run: a `trust` command that
 * finished. Main re-reads the folder's trust when the command changes it (ADR 0159 decision 3)
 * but tells the window nothing, so the banner and Manage Trust would show the old answer.
 */
export const refreshesWorkspace = (session: CommandSession): boolean =>
  session.state === 'finished' && session.words?.[0] === 'trust';

/** Events for a run whose id `cli:run` has not answered yet are kept for this many runs. */
const EARLY_RUNS = 20;

type EarlyEvent =
  | { readonly kind: 'output'; readonly event: CliOutput }
  | { readonly kind: 'state'; readonly event: CliState }
  | { readonly kind: 'diagnostics'; readonly event: CliDiagnostics };

export class CommandSessions {
  private list: CommandSession[] = [];
  private activeId = '';
  private counter = 0;
  private readonly ansi = new Map<string, AnsiState>();
  private readonly listeners = new Set<() => void>();
  /**
   * Events that arrived before `cli:run` answered with their run's id: main may push the first
   * output before the answer to the invoke reaches the window. Applied when the run is bound.
   */
  private readonly early = new Map<string, EarlyEvent[]>();

  /** Called with a session whose run has just ended, finished or cancelled. */
  onEnded: (session: CommandSession) => void = () => undefined;

  constructor() {
    this.create();
  }

  get sessions(): readonly CommandSession[] {
    return this.list;
  }

  get active(): CommandSession {
    return (
      this.list.find((session) => session.id === this.activeId) ?? (this.list[0] as CommandSession)
    );
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  private update(id: string, change: (session: CommandSession) => CommandSession): void {
    this.list = this.list.map((session) => (session.id === id ? change(session) : session));
    this.changed();
  }

  private byRun(runId: string): CommandSession | undefined {
    return this.list.find((session) => session.runId === runId);
  }

  /** A new tab, in front. */
  create(): CommandSession {
    this.counter += 1;
    const session: CommandSession = {
      id: `session-${String(this.counter)}`,
      number: this.counter,
      state: 'idle',
      scrollback: EMPTY_SCROLLBACK,
      diagnostics: [],
    };
    this.list = [...this.list, session];
    this.activeId = session.id;
    this.changed();
    return session;
  }

  select(id: string): void {
    if (!this.list.some((session) => session.id === id)) return;
    this.activeId = id;
    this.changed();
  }

  /**
   * Closes a tab and answers the run it was running, which the caller stops: a `watch` ends
   * when its session closes (ADR 0159 decision 3). The last tab closed leaves a fresh one.
   */
  close(id: string): string | undefined {
    const index = this.list.findIndex((session) => session.id === id);
    const closing = this.list[index];
    if (closing === undefined) return undefined;
    this.list = this.list.filter((session) => session.id !== id);
    if (closing.runId !== undefined) this.ansi.delete(closing.runId);
    if (this.list.length === 0) {
      this.create();
    } else {
      if (this.activeId === id) {
        this.activeId = (this.list[Math.min(index, this.list.length - 1)] as CommandSession).id;
      }
      this.changed();
    }
    return closing.runId !== undefined && isBusy(closing) ? closing.runId : undefined;
  }

  note(id: string, text: string): void {
    this.update(id, (session) => ({ ...session, scrollback: withNote(session.scrollback, text) }));
  }

  clear(id: string): void {
    this.update(id, (session) => ({ ...session, scrollback: EMPTY_SCROLLBACK }));
  }

  /** The run `cli:run` started for this session's line, now that its id is known. */
  started(id: string, line: string, words: readonly string[], runId: string): void {
    this.ansi.set(runId, freshAnsiState());
    this.update(id, (session) => ({
      ...session,
      line,
      words,
      runId,
      state: 'running',
      diagnostics: [],
    }));
    const early = this.early.get(runId) ?? [];
    this.early.delete(runId);
    for (const item of early) {
      if (item.kind === 'output') this.output(item.event);
      else if (item.kind === 'state') this.state(item.event);
      else this.diagnostics(item.event);
    }
  }

  private keepEarly(runId: string, item: EarlyEvent): void {
    this.early.set(runId, [...(this.early.get(runId) ?? []), item]);
    // A run some other part of the window started is never bound here: forget the oldest.
    for (const stale of [...this.early.keys()].slice(0, -EARLY_RUNS)) this.early.delete(stale);
  }

  output(event: CliOutput): void {
    const session = this.byRun(event.runId);
    if (session === undefined) {
      this.keepEarly(event.runId, { kind: 'output', event });
      return;
    }
    const ansi = this.ansi.get(event.runId) ?? freshAnsiState();
    this.ansi.set(event.runId, ansi);
    this.update(session.id, (current) => ({
      ...current,
      scrollback: withOutput(current.scrollback, event.stream, event.text, ansi),
    }));
  }

  state(event: CliState): void {
    const session = this.byRun(event.runId);
    if (session === undefined) {
      this.keepEarly(event.runId, { kind: 'state', event });
      return;
    }
    // A `cancelled` stays cancelled: a command that could not stop still finishes later, and
    // the tab must not then claim it ended on its own (ADR 0159 decision 6).
    if (session.state === 'cancelled') return;
    this.update(session.id, (current) => {
      const { code: _code, question: _question, ...rest } = current;
      return {
        ...rest,
        state: event.state,
        ...(event.code === undefined ? {} : { code: event.code }),
        ...(event.question === undefined ? {} : { question: event.question }),
      };
    });
    if (event.state === 'finished' || event.state === 'cancelled') {
      const ended = this.byRun(event.runId);
      if (ended !== undefined) this.onEnded(ended);
    }
  }

  diagnostics(event: CliDiagnostics): void {
    const session = this.byRun(event.runId);
    if (session === undefined) {
      this.keepEarly(event.runId, { kind: 'diagnostics', event });
      return;
    }
    this.update(session.id, (current) => ({
      ...current,
      diagnostics: [...current.diagnostics, ...event.diagnostics],
    }));
  }
}
