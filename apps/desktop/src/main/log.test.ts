import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOG_FILE, PREVIOUS_LOG_FILE, crashSummary, fileLog, installCrashHandlers } from './log.js';

/**
 * Driven against a real folder, which `recent-files.test.ts` already does and for its reason:
 * what is being asserted is what reaches a disk, and a fake filesystem would assert the fake.
 *
 * The folder deliberately does **not** exist when the log is built — that is the state the app
 * is in the first time it ever runs, and a log that needed somebody to create its own folder
 * would write nothing on exactly the machine it matters most on.
 */

let scratch: string;
let directory: string;

const lines = (): string[] =>
  readFileSync(join(directory, LOG_FILE), 'utf8').split('\n').filter(Boolean);

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-log-'));
  directory = join(scratch, 'logs');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('fileLog', () => {
  it('writes a line naming the level, the version and the platform', () => {
    fileLog({ directory, version: '0.2.0', platform: 'win32' }).error('export failed');

    expect(lines()).toHaveLength(1);
    // The three facts a report is useless without: which build, which OS, how bad.
    expect(lines()[0]).toContain('ERROR');
    expect(lines()[0]).toContain('0.2.0');
    expect(lines()[0]).toContain('win32');
    expect(lines()[0]).toContain('export failed');
  });

  it('timestamps every line', () => {
    fileLog({ directory, version: '0.2.0', platform: 'linux' }).warn('preview was slow');

    expect(lines()[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \|/u);
  });

  it('keeps one entry to one line, however many the stack had', () => {
    const log = fileLog({ directory, version: '0.2.0', platform: 'darwin' });
    const error = new Error('disk is full');
    error.stack = 'Error: disk is full\n    at write (a.ts:1:1)\n    at save (b.ts:2:2)';

    log.error('save failed', error);

    // One entry spanning nine lines cannot be grepped, counted, or truncated at a boundary —
    // and a log that cannot be counted has no ceiling that means anything.
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain('at write (a.ts:1:1)');
    expect(lines()[0]).toContain('at save (b.ts:2:2)');
  });

  it('carries an Error as its stack, not as [object Object]', () => {
    fileLog({ directory, version: '0.2.0', platform: 'linux' }).error('boom', new Error('why'));

    expect(lines()[0]).toContain('why');
    expect(lines()[0]).not.toContain('[object Object]');
  });

  it('survives a detail that will not serialise', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    // A logger that throws inside an error path is a loop, and the error path is the only
    // path this file is ever on.
    expect(() => {
      fileLog({ directory, version: '0.2.0', platform: 'linux' }).error('odd', circular);
    }).not.toThrow();
    expect(lines()).toHaveLength(1);
  });

  it('creates the folder it was given, because the first run has none', () => {
    fileLog({ directory, version: '0.2.0', platform: 'linux' }).info('started');

    expect(lines()).toHaveLength(1);
  });

  it('keeps the newest entries and drops the oldest once the ceiling is crossed', () => {
    const log = fileLog({ directory, version: '0.2.0', platform: 'linux', maxBytes: 200 });

    for (let index = 0; index < 20; index += 1) log.error(`failure number ${String(index)}`);

    const current = readFileSync(join(directory, LOG_FILE), 'utf8');
    const previous = readFileSync(join(directory, PREVIOUS_LOG_FILE), 'utf8');

    // What the newest entry is, is the whole point: a tester sends the file after the thing
    // went wrong, and a log that kept the first 200 bytes of the session would be useless.
    expect(current).toContain('failure number 19');
    // And the oldest is gone from both files, which is what a ceiling means — dropped, not
    // archived somewhere else.
    expect(current).not.toContain('failure number 0 ');
    expect(previous).not.toContain('failure number 0 ');
  });

  it('never grows past two files, however many entries it is given', () => {
    const log = fileLog({ directory, version: '0.2.0', platform: 'linux', maxBytes: 120 });

    for (let index = 0; index < 60; index += 1) log.error(`entry ${String(index)}`);

    // Counted rather than asserted by name: a third generation would be a log that grows
    // forever on a tester's disk, which is the second bug this card could have shipped.
    expect(readdirSync(directory).sort()).toEqual([LOG_FILE, PREVIOUS_LOG_FILE].sort());
    const total = readdirSync(directory)
      .map((name) => statSync(join(directory, name)).size)
      .reduce((sum, size) => sum + size, 0);
    expect(total).toBeLessThan(2 * 120 + 200);
  });

  it('says nothing and throws nothing when the path cannot be a folder', () => {
    // A file where the folder should be: `mkdirSync` refuses, and the app must not care.
    writeFileSync(join(scratch, 'blocked'), 'not a folder', 'utf8');
    const log = fileLog({
      directory: join(scratch, 'blocked'),
      version: '0.2.0',
      platform: 'linux',
    });

    expect(() => {
      log.error('still fine');
    }).not.toThrow();
  });

  it('reports where it lives, because a menu item has to open it', () => {
    expect(fileLog({ directory, version: '0.2.0', platform: 'linux' }).directory).toBe(directory);
  });
});

describe('installCrashHandlers', () => {
  it('writes a line for an uncaught exception, and does not re-throw', () => {
    const handlers = new Map<string, (value: never) => void>();
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    installCrashHandlers(
      {
        on: (event: string, handler: (value: never) => void) => handlers.set(event, handler),
      } as never,
      log,
    );

    const error = new Error('main fell over');
    // Re-throwing here would be fatal in Node — an exception inside an `uncaughtException`
    // listener ends the process — so the handler must return normally. That is the assertion.
    expect(() => {
      handlers.get('uncaughtException')?.(error as never);
    }).not.toThrow();
    expect(log.error).toHaveBeenCalledWith('uncaught exception in main', error);
  });

  it('writes a line for an unhandled rejection', () => {
    const handlers = new Map<string, (value: never) => void>();
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    installCrashHandlers(
      {
        on: (event: string, handler: (value: never) => void) => handlers.set(event, handler),
      } as never,
      log,
    );

    handlers.get('unhandledRejection')?.('nobody caught this' as never);

    expect(log.error).toHaveBeenCalledWith('unhandled rejection in main', 'nobody caught this');
  });
});

/**
 * The half TYTO-140 added: a crash that reaches a screen as well as a file.
 *
 * The box itself is `dialog.showErrorBox`, which is Electron's and so the composition root's.
 * What is testable here is the port — that it is called, with what, for both kinds of crash,
 * and that it cannot take the process down.
 */
describe('installCrashHandlers, reporting', () => {
  const wired = (onCrash?: (reason: unknown) => void) => {
    const handlers = new Map<string, (value: never) => void>();
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    installCrashHandlers(
      {
        on: (event: string, handler: (value: never) => void) => handlers.set(event, handler),
      } as never,
      log,
      onCrash,
    );
    return { handlers, log };
  };

  it('reports an uncaught exception, after writing it down', () => {
    const onCrash = vi.fn();
    const { handlers, log } = wired(onCrash);
    const error = new Error('main fell over');

    handlers.get('uncaughtException')?.(error as never);

    // Written first, reported second, and the order is the point: the box can fail and the
    // line is what a report is made of.
    expect(log.error).toHaveBeenCalledWith('uncaught exception in main', error);
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(onCrash).toHaveBeenCalledWith(error);
  });

  it('reports an unhandled rejection too, which is the startup case', () => {
    const onCrash = vi.fn();
    const { handlers } = wired(onCrash);

    // A `throw` inside `start()` is this, not an exception — and Electron runs with
    // `--unhandled-rejections` in `warn` mode, so this path never had a box to lose.
    handlers.get('unhandledRejection')?.('boom' as never);

    expect(onCrash).toHaveBeenCalledWith('boom');
  });

  it('survives a report that throws, and writes that down as well', () => {
    const onCrash = vi.fn(() => {
      throw new Error('no display');
    });
    const { handlers, log } = wired(onCrash);

    // **The case this guard exists for.** This runs inside an `uncaughtException` listener,
    // where Node treats a raised exception as fatal — so a box that failed to draw would turn
    // a reported crash into a silently killed process, which is worse than the state the card
    // started from.
    expect(() => handlers.get('uncaughtException')?.(new Error('x') as never)).not.toThrow();
    expect(log.error).toHaveBeenCalledWith('the crash report itself failed', expect.any(Error));
  });

  it('still works with no reporter at all, which is every test that has one', () => {
    const { handlers, log } = wired();

    expect(() => handlers.get('uncaughtException')?.(new Error('x') as never)).not.toThrow();
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

describe('crashSummary', () => {
  it('gives an error its name and message, on one line', () => {
    const error = new Error('EACCES: permission denied');
    error.stack = 'Error: EACCES: permission denied\n    at open (node:fs:1)';

    // Not the stack, which is what the log keeps: a box holding nine lines of frames is a box
    // whose first line — the only part that says anything — is off the top.
    expect(crashSummary(error)).toBe('Error: EACCES: permission denied');
  });

  it('says something for a rejection that carried no error', () => {
    // A rejection can carry anything at all, and a blank box is the failure this card removes.
    expect(crashSummary(undefined)).toBe('unknown error');
    expect(crashSummary('')).toBe('unknown error');
    expect(crashSummary({ code: 'ENOENT' })).toContain('object');
  });

  it('caps a long one rather than filling the screen', () => {
    expect(crashSummary('x'.repeat(1000))).toHaveLength(300);
    expect(crashSummary('x'.repeat(1000)).endsWith('…')).toBe(true);
  });
});
