import { describe, expect, it } from 'vitest';

import {
  type PseudoTerminal,
  type SpawnOptions,
  type TerminalDependencies,
  REPLAY_BYTES,
  TERMINAL_RESTRICTED,
  createTerminals,
  killTree,
  programName,
  terminalQuitGuard,
} from './terminal.js';

/** A pseudo-terminal with no shell behind it: the test types its output and its exit. */
class FakePty implements PseudoTerminal {
  readonly written: string[] = [];
  readonly sizes: [number, number][] = [];
  killed = 0;
  process = 'bash';
  private data: ((data: string) => void)[] = [];
  private exits: ((event: { exitCode: number }) => void)[] = [];

  constructor(readonly pid: number) {}

  onData(listener: (data: string) => void): void {
    this.data.push(listener);
  }
  onExit(listener: (event: { exitCode: number }) => void): void {
    this.exits.push(listener);
  }
  write(data: string): void {
    this.written.push(data);
  }
  resize(columns: number, rows: number): void {
    this.sizes.push([columns, rows]);
  }
  kill(): void {
    this.killed += 1;
  }
  print(data: string): void {
    for (const listener of this.data) listener(data);
  }
  end(exitCode: number): void {
    for (const listener of this.exits) listener({ exitCode });
  }
}

const harness = (overrides: Partial<TerminalDependencies> = {}) => {
  const spawned: { file: string; args: readonly string[]; options: SpawnOptions; pty: FakePty }[] =
    [];
  const outputs: [string, string][] = [];
  const exits: [string, number][] = [];
  const killed: FakePty[] = [];
  const frames: (() => void)[] = [];
  let restricted = false;
  let folder: string | null = '/work/folder';
  const terminals = createTerminals({
    spawn: (file, args, options) => {
      const pty = new FakePty(100 + spawned.length);
      spawned.push({ file, args, options, pty });
      return pty;
    },
    shell: () => ({ file: '/bin/bash', args: [], title: 'bash' }),
    folder: () => folder,
    home: () => '/home/person',
    restricted: () => restricted,
    environment: () => ({ TERM: 'xterm-256color' }),
    output: (terminalId, data) => outputs.push([terminalId, data]),
    exit: (terminalId, code) => exits.push([terminalId, code]),
    killTree: (pty) => {
      killed.push(pty as FakePty);
    },
    schedule: (flush) => frames.push(flush),
    foregroundKnown: true,
    ...overrides,
  });
  return {
    terminals,
    spawned,
    outputs,
    exits,
    killed,
    runFrames: () => {
      for (const flush of frames.splice(0)) flush();
    },
    restrict: (value: boolean) => {
      restricted = value;
    },
    openFolder: (value: string | null) => {
      folder = value;
    },
  };
};

describe('opening a terminal (ADR 0164)', () => {
  it('starts the chosen shell in the open folder, at the size the window measured', () => {
    const { terminals, spawned } = harness();

    const opened = terminals.open({ cols: 120, rows: 30 });

    expect(opened).toEqual({ terminalId: 'terminal-1', title: 'bash' });
    expect(spawned[0]).toMatchObject({
      file: '/bin/bash',
      args: [],
      options: { cols: 120, rows: 30, cwd: '/work/folder', env: { TERM: 'xterm-256color' } },
    });
  });

  it('starts in the home folder with no workspace open', () => {
    const { terminals, spawned, openFolder } = harness();
    openFolder(null);

    terminals.open({ cols: 80, rows: 24 });

    expect(spawned[0]?.options.cwd).toBe('/home/person');
  });

  it('is refused in main while the workspace is restricted, and starts nothing', () => {
    const { terminals, spawned, restrict } = harness();
    restrict(true);

    const opened = terminals.open({ cols: 80, rows: 24 });

    expect(opened).toEqual({ refused: 'restricted', message: TERMINAL_RESTRICTED });
    expect(spawned).toHaveLength(0);
    expect(terminals.list()).toEqual([]);
  });

  it('keeps a terminal already open running when a restricted folder opens later', () => {
    const { terminals, restrict, openFolder } = harness();
    const first = terminals.open({ cols: 80, rows: 24 });
    openFolder('/copied/folder');
    restrict(true);

    expect(terminals.list().map((terminal) => terminal.terminalId)).toEqual([
      'terminalId' in first ? first.terminalId : '',
    ]);
    expect(terminals.open({ cols: 80, rows: 24 })).toMatchObject({ refused: 'restricted' });
  });

  it('says a shell that could not start, rather than throwing across the channel', () => {
    const { terminals } = harness({
      spawn: () => {
        throw new Error('File not found: nu');
      },
    });

    expect(terminals.open({ cols: 80, rows: 24 })).toEqual({
      refused: 'failed',
      message: 'bash did not start: File not found: nu',
    });
  });
});

describe('a running terminal', () => {
  it('sends what is typed and the new size to its own shell only', () => {
    const { terminals, spawned } = harness();
    terminals.open({ cols: 80, rows: 24 });
    terminals.open({ cols: 80, rows: 24 });

    terminals.input('terminal-2', 'echo hi\r');
    terminals.resize('terminal-2', 100, 40);
    terminals.input('terminal-9', 'nobody');

    expect(spawned[0]?.pty.written).toEqual([]);
    expect(spawned[1]?.pty.written).toEqual(['echo hi\r']);
    expect(spawned[1]?.pty.sizes).toEqual([[100, 40]]);
  });

  it('batches output to one event per frame', () => {
    const { terminals, spawned, outputs, runFrames } = harness();
    terminals.open({ cols: 80, rows: 24 });
    const pty = spawned[0]!.pty;

    pty.print('a');
    pty.print('b');
    pty.print('c');
    expect(outputs).toEqual([]);
    runFrames();

    expect(outputs).toEqual([['terminal-1', 'abc']]);
  });

  it('flushes what the shell printed last before it says the shell exited, then forgets it', () => {
    const { terminals, spawned, outputs, exits } = harness();
    terminals.open({ cols: 80, rows: 24 });

    spawned[0]!.pty.print('bye');
    spawned[0]!.pty.end(3);

    expect(outputs).toEqual([['terminal-1', 'bye']]);
    expect(exits).toEqual([['terminal-1', 3]]);
    expect(terminals.list()).toEqual([]);
  });
});

describe('the replay a reloaded window draws again', () => {
  it('holds what the shell printed, after the events already went out', () => {
    const { terminals, spawned, runFrames } = harness();
    terminals.open({ cols: 80, rows: 24 });
    spawned[0]!.pty.print('$ echo hi\r\nhi\r\n');
    runFrames();

    expect(terminals.list()).toEqual([
      { terminalId: 'terminal-1', title: 'bash', replay: '$ echo hi\r\nhi\r\n' },
    ]);
  });

  it('is capped at 256 KiB of UTF-8, keeping the newest output', () => {
    const { terminals, spawned } = harness();
    terminals.open({ cols: 80, rows: 24 });
    const pty = spawned[0]!.pty;
    const line = `${'é'.repeat(511)}\n`; // 1 023 bytes of UTF-8 in 512 code units

    for (let index = 0; index < 300; index += 1)
      pty.print(`${String(index).padStart(3, '0')}${line}`);

    const replay = terminals.list()[0]!.replay;
    expect(new TextEncoder().encode(replay).length).toBeLessThanOrEqual(REPLAY_BYTES);
    expect(new TextEncoder().encode(replay).length).toBeGreaterThan(REPLAY_BYTES - 1026);
    expect(replay.endsWith(`299${line}`)).toBe(true);
    expect(replay.startsWith('000')).toBe(false);
  });

  it('survives the open folder changing', () => {
    const { terminals, spawned, openFolder } = harness();
    terminals.open({ cols: 80, rows: 24 });
    spawned[0]!.pty.print('kept');

    openFolder('/another/folder');

    expect(terminals.list()[0]?.replay).toBe('kept');
  });
});

describe('ending terminals', () => {
  it('kills one terminal tree on its tab closing, and every one on quit', () => {
    const { terminals, spawned, killed } = harness();
    terminals.open({ cols: 80, rows: 24 });
    terminals.open({ cols: 80, rows: 24 });
    terminals.open({ cols: 80, rows: 24 });

    terminals.kill('terminal-2');
    expect(killed).toEqual([spawned[1]!.pty]);

    terminals.killAll();
    expect(killed).toEqual([spawned[1]!.pty, spawned[0]!.pty, spawned[2]!.pty]);
    expect(terminals.list()).toEqual([]);
  });

  it("signals the process group on macOS and Linux, and ends Windows' tree without node-pty's kill", () => {
    const signalled: number[] = [];
    const ended: number[] = [];
    const unixPty = new FakePty(4242);
    const windowsPty = new FakePty(77);

    killTree(
      'linux',
      (pid) => signalled.push(pid),
      (pid) => ended.push(pid),
    )(unixPty);
    killTree(
      'win32',
      (pid) => signalled.push(pid),
      (pid) => ended.push(pid),
    )(windowsPty);

    expect(signalled).toEqual([-4242]);
    expect(unixPty.killed).toBe(1);
    expect(ended).toEqual([77]);
    // node-pty's Windows kill forks, which the packaged app cannot (ADR 0067).
    expect(windowsPty.killed).toBe(0);
  });

  it('reports no exit for a terminal main ended, which may come after the window is gone', () => {
    const { terminals, spawned, outputs, exits } = harness();
    terminals.open({ cols: 80, rows: 24 });
    terminals.open({ cols: 80, rows: 24 });

    terminals.kill('terminal-1');
    terminals.killAll();
    spawned[0]!.pty.print('late');
    spawned[0]!.pty.end(0);
    spawned[1]!.pty.end(129);

    expect(exits).toEqual([]);
    expect(outputs).toEqual([]);
  });

  it('still kills the shell when its group is already gone', () => {
    const pty = new FakePty(5);

    killTree(
      'darwin',
      () => {
        throw new Error('ESRCH');
      },
      () => {},
    )(pty);

    expect(pty.killed).toBe(1);
  });
});

describe('the quit question', () => {
  it('names the terminals running a program other than their shell', () => {
    const { terminals, spawned } = harness();
    terminals.open({ cols: 80, rows: 24 });
    terminals.open({ cols: 80, rows: 24 });

    spawned[1]!.pty.process = 'vim';

    expect(terminals.busy()).toEqual(['bash']);
  });

  it('asks about nothing where node-pty cannot name the program in front (Windows)', () => {
    const { terminals, spawned } = harness({ foregroundKnown: false });
    terminals.open({ cols: 80, rows: 24 });

    spawned[0]!.pty.process = 'xterm-256color';

    expect(terminals.busy()).toEqual([]);
  });

  it('reads an idle shell as idle on every platform, by its program name', () => {
    expect(programName('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe(
      'powershell',
    );
    expect(programName('-zsh')).toBe('zsh');
    expect(programName('/bin/bash')).toBe('bash');
    expect(programName('PWSH.EXE')).toBe('pwsh');
  });

  it('asks once, and lets the quit through with nothing running', () => {
    const asked: (readonly string[])[] = [];
    let busy: string[] = [];
    const mayQuit = terminalQuitGuard(
      () => busy,
      (titles) => {
        asked.push(titles);
        return asked.length > 1;
      },
    );

    expect(mayQuit()).toBe(true);
    busy = ['zsh'];
    expect(mayQuit()).toBe(false);
    expect(mayQuit()).toBe(true);
    expect(mayQuit()).toBe(true);
    expect(asked).toEqual([['zsh'], ['zsh']]);
  });
});
