/**
 * The window's side of the terminals (TYTO-497, ADR 0164): which terminals main has open, which
 * one is in front, and the view that draws each. It lives for the window's life, as the command
 * panel's sessions do, because the dock makes a new panel element whenever the layout changes and
 * a shell's screen must not go with it.
 *
 * Main owns the shells; this only asks it to open, type, resize and end them, and draws what it
 * prints. The view is a port: `terminal-view.ts` is xterm, loaded the first time a terminal is
 * shown, and the tests hand in a fake.
 */

/** One terminal's screen: xterm, or a fake in the tests. */
export interface TerminalView {
  /** The node xterm draws into; the panel element moves it in and out of its own body. */
  readonly element: HTMLElement;
  write(data: string): void;
  focus(): void;
  /** Fits the screen to its node and answers the new size, or nothing when it cannot measure. */
  fit(): { cols: number; rows: number } | undefined;
  /** Repaints with the window's colours and code font, after a theme or settings change. */
  restyle(): void;
  dispose(): void;
}

export interface TerminalPorts {
  readonly open: (size: {
    cols: number;
    rows: number;
  }) => Promise<
    { terminalId: string; title: string } | { refused: 'restricted' | 'failed'; message: string }
  >;
  readonly input: (terminalId: string, data: string) => void;
  readonly resize: (terminalId: string, cols: number, rows: number) => void;
  readonly kill: (terminalId: string) => void;
  readonly list: () => Promise<readonly { terminalId: string; title: string; replay: string }[]>;
  /** Makes a view whose keystrokes go to `send`: xterm, loaded on the first call. */
  readonly view: (send: (data: string) => void) => Promise<TerminalView>;
  /** The line a terminal's end prints, in the window's language. */
  readonly exited: (code: number) => string;
}

export interface TerminalSession {
  readonly terminalId: string;
  readonly title: string;
  /** 1, 2, 3… in the order they opened, for a tab's name when two share a title. */
  readonly number: number;
  /** Set once the shell has exited; the tab stays until it is closed. */
  readonly exitCode?: number;
}

/** Why the last open did not start a shell, for the panel to say: a restricted folder, or a failure. */
export interface TerminalRefusal {
  readonly reason: 'restricted' | 'failed';
  readonly message: string;
}

/** The size a terminal opens at before its screen has been measured; the first fit corrects it. */
const DEFAULT_SIZE = { cols: 80, rows: 24 };

export class TerminalSessions {
  #sessions: TerminalSession[] = [];
  #active: string | undefined;
  #refusal: TerminalRefusal | undefined;
  #next = 1;
  readonly #views = new Map<string, TerminalView>();
  readonly #pending = new Map<string, string>();
  readonly #listeners = new Set<() => void>();

  constructor(private readonly ports: TerminalPorts) {}

  get sessions(): readonly TerminalSession[] {
    return this.#sessions;
  }

  get active(): TerminalSession | undefined {
    return this.#sessions.find((session) => session.terminalId === this.#active);
  }

  get refusal(): TerminalRefusal | undefined {
    return this.#refusal;
  }

  /** The view drawing `terminalId`, once xterm has made it. */
  view(terminalId: string): TerminalView | undefined {
    return this.#views.get(terminalId);
  }

  /** Called on every change, so the panel element repaints. Returns the unsubscribe. */
  listen(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The terminals main kept across a reload, each drawn again from its replay. */
  async restore(): Promise<void> {
    const open = await this.ports.list();
    for (const terminal of open) {
      if (this.#sessions.some((session) => session.terminalId === terminal.terminalId)) continue;
      this.#add(terminal.terminalId, terminal.title);
      this.#pending.set(terminal.terminalId, terminal.replay);
    }
    await Promise.all(open.map((terminal) => this.#ensureView(terminal.terminalId)));
    this.#changed();
  }

  /** Opens a new terminal in front; a refusal is kept for the panel to say and nothing opens. */
  async create(size: { cols: number; rows: number } = DEFAULT_SIZE): Promise<string | undefined> {
    const opened = await this.ports.open(size);
    if ('refused' in opened) {
      this.#refusal = { reason: opened.refused, message: opened.message };
      this.#changed();
      return undefined;
    }
    this.#refusal = undefined;
    this.#add(opened.terminalId, opened.title);
    await this.#ensureView(opened.terminalId);
    this.#changed();
    return opened.terminalId;
  }

  select(terminalId: string): void {
    if (!this.#sessions.some((session) => session.terminalId === terminalId)) return;
    this.#active = terminalId;
    this.#changed();
  }

  /** Ends the shell if it still runs, and forgets the terminal; the next one comes to the front. */
  close(terminalId: string): void {
    const index = this.#sessions.findIndex((session) => session.terminalId === terminalId);
    if (index < 0) return;
    if (this.#sessions[index]?.exitCode === undefined) this.ports.kill(terminalId);
    this.#views.get(terminalId)?.dispose();
    this.#views.delete(terminalId);
    this.#pending.delete(terminalId);
    this.#sessions.splice(index, 1);
    if (this.#active === terminalId) {
      this.#active = (this.#sessions[index] ?? this.#sessions[index - 1])?.terminalId;
    }
    this.#changed();
  }

  /** What main says the shell printed. */
  output(terminalId: string, data: string): void {
    const view = this.#views.get(terminalId);
    if (view !== undefined) {
      view.write(data);
      return;
    }
    if (!this.#sessions.some((session) => session.terminalId === terminalId)) return;
    this.#pending.set(terminalId, (this.#pending.get(terminalId) ?? '') + data);
  }

  /** The shell ended: its tab stays, says so, and takes no more typing. */
  exit(terminalId: string, code: number): void {
    const index = this.#sessions.findIndex((session) => session.terminalId === terminalId);
    const session = this.#sessions[index];
    if (session === undefined) return;
    this.#sessions[index] = { ...session, exitCode: code };
    this.output(terminalId, `\r\n\x1b[2m${this.ports.exited(code)}\x1b[22m\r\n`);
    this.#changed();
  }

  /** Fits the terminal in front to its node and tells main the size its shell now has. */
  fit(): void {
    const session = this.active;
    if (session === undefined || session.exitCode !== undefined) return;
    const size = this.#views.get(session.terminalId)?.fit();
    if (size !== undefined) this.ports.resize(session.terminalId, size.cols, size.rows);
  }

  restyle(): void {
    for (const view of this.#views.values()) view.restyle();
  }

  /** A folder that changed may be trusted now, so the last refusal is not repeated as current. */
  forgetRefusal(): void {
    if (this.#refusal === undefined) return;
    this.#refusal = undefined;
    this.#changed();
  }

  #add(terminalId: string, title: string): void {
    this.#sessions.push({ terminalId, title, number: this.#next });
    this.#next += 1;
    this.#active = terminalId;
  }

  async #ensureView(terminalId: string): Promise<void> {
    if (this.#views.has(terminalId)) return;
    const view = await this.ports.view((data) => {
      const session = this.#sessions.find((each) => each.terminalId === terminalId);
      if (session !== undefined && session.exitCode === undefined) {
        this.ports.input(terminalId, data);
      }
    });
    // Closed while xterm was loading: nothing is left to draw.
    if (!this.#sessions.some((session) => session.terminalId === terminalId)) {
      view.dispose();
      return;
    }
    this.#views.set(terminalId, view);
    const waiting = this.#pending.get(terminalId);
    this.#pending.delete(terminalId);
    if (waiting !== undefined && waiting !== '') view.write(waiting);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}
