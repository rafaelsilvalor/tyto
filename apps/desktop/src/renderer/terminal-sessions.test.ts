// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { type TerminalPorts, type TerminalView, TerminalSessions } from './terminal-sessions.js';

/** A screen that records what it was told, standing in for xterm. */
class FakeView implements TerminalView {
  readonly element = document.createElement('div');
  readonly written: string[] = [];
  disposed = false;
  restyled = 0;
  size: { cols: number; rows: number } | undefined = { cols: 120, rows: 30 };

  constructor(readonly send: (data: string) => void) {}

  write(data: string): void {
    this.written.push(data);
  }
  focus(): void {}
  fit(): { cols: number; rows: number } | undefined {
    return this.size;
  }
  restyle(): void {
    this.restyled += 1;
  }
  dispose(): void {
    this.disposed = true;
  }
}

const harness = (refuse?: { refused: 'restricted' | 'failed'; message: string }) => {
  const calls: string[] = [];
  const views: FakeView[] = [];
  let next = 1;
  let kept: { terminalId: string; title: string; replay: string }[] = [];
  const ports: TerminalPorts = {
    open: (size) => {
      calls.push(`open ${String(size.cols)}x${String(size.rows)}`);
      if (refuse !== undefined) return Promise.resolve(refuse);
      return Promise.resolve({ terminalId: `terminal-${String(next++)}`, title: 'bash' });
    },
    input: (terminalId, data) => calls.push(`input ${terminalId} ${data}`),
    resize: (terminalId, cols, rows) =>
      calls.push(`resize ${terminalId} ${String(cols)}x${String(rows)}`),
    kill: (terminalId) => calls.push(`kill ${terminalId}`),
    list: () => Promise.resolve(kept),
    view: (send) => {
      const view = new FakeView(send);
      views.push(view);
      return Promise.resolve(view);
    },
    exited: (code) => `Process exited with code ${String(code)}`,
  };
  return {
    sessions: new TerminalSessions(ports),
    calls,
    views,
    keep: (terminals: typeof kept) => {
      kept = terminals;
    },
  };
};

describe("the window's terminals (ADR 0164)", () => {
  it('opens a terminal in front and types into it through main, by its id', async () => {
    const { sessions, calls, views } = harness();

    const terminalId = await sessions.create();
    views[0]!.send('ls\r');

    expect(terminalId).toBe('terminal-1');
    expect(sessions.active?.terminalId).toBe('terminal-1');
    expect(calls).toEqual(['open 80x24', 'input terminal-1 ls\r']);
  });

  it('keeps what arrived before the screen existed, and draws it once it does', async () => {
    const { sessions, views, keep } = harness();
    keep([{ terminalId: 'terminal-7', title: 'zsh', replay: '$ echo kept\r\nkept\r\n' }]);

    await sessions.restore();

    expect(sessions.sessions.map((session) => session.title)).toEqual(['zsh']);
    expect(views[0]?.written).toEqual(['$ echo kept\r\nkept\r\n']);
  });

  it('draws output into the terminal it belongs to, and drops output for a closed one', async () => {
    const { sessions, views } = harness();
    await sessions.create();
    await sessions.create();

    sessions.output('terminal-1', 'one');
    sessions.output('terminal-2', 'two');
    sessions.output('terminal-9', 'nobody');

    expect(views.map((view) => view.written)).toEqual([['one'], ['two']]);
  });

  it('keeps a restricted folder’s refusal for the panel to say, and opens nothing', async () => {
    const { sessions, views } = harness({ refused: 'restricted', message: 'restricted' });

    expect(await sessions.create()).toBeUndefined();
    expect(sessions.refusal).toEqual({ reason: 'restricted', message: 'restricted' });
    expect(sessions.sessions).toEqual([]);
    expect(views).toEqual([]);

    sessions.forgetRefusal();
    expect(sessions.refusal).toBeUndefined();
  });

  it('says an exit in the screen, keeps the tab, and stops sending keys to a shell that ended', async () => {
    const { sessions, views, calls } = harness();
    await sessions.create();

    sessions.exit('terminal-1', 3);
    views[0]!.send('typed after');

    expect(sessions.active?.exitCode).toBe(3);
    expect(views[0]?.written.at(-1)).toContain('Process exited with code 3');
    expect(calls.filter((call) => call.startsWith('input'))).toEqual([]);
  });

  it('kills a running shell on close and brings the next terminal forward; an ended one is only forgotten', async () => {
    const { sessions, views, calls } = harness();
    await sessions.create();
    await sessions.create();
    await sessions.create();
    sessions.select('terminal-2');
    sessions.exit('terminal-3', 0);

    sessions.close('terminal-2');
    sessions.close('terminal-3');

    expect(calls.filter((call) => call.startsWith('kill'))).toEqual(['kill terminal-2']);
    expect(views[1]?.disposed).toBe(true);
    expect(sessions.sessions.map((session) => session.terminalId)).toEqual(['terminal-1']);
    expect(sessions.active?.terminalId).toBe('terminal-1');
  });

  it('tells main the size the screen fits, for the terminal in front only', async () => {
    const { sessions, views, calls } = harness();
    await sessions.create();
    views[0]!.size = { cols: 132, rows: 40 };

    sessions.fit();
    views[0]!.size = undefined;
    sessions.fit();

    expect(calls.filter((call) => call.startsWith('resize'))).toEqual(['resize terminal-1 132x40']);
  });

  it('repaints every screen when the theme or the code font changes', async () => {
    const { sessions, views } = harness();
    await sessions.create();
    await sessions.create();

    sessions.restyle();

    expect(views.map((view) => view.restyled)).toEqual([1, 1]);
  });
});
