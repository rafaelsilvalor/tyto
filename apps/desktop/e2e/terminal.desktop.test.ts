import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The terminals main owns (TYTO-497, ADR 0164), through the bridge.
 *
 * Only what needs the real app is here: node-pty loading in Electron's main, a real shell
 * answering through `terminal:output`, a reload that keeps the terminal and its replay, and the
 * refusal in a restricted folder with main's real workspace. The rules themselves (the shell, the
 * environment, the cap, the kill) are `src/main/terminal.test.ts` and `terminal-shell.test.ts`.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139). No tab draws a terminal yet: the page
 * calls the bridge the way the tab will.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}

/** Computed by the shell, so the marker is never in the typed text and an echo cannot pass. */
const ECHO =
  process.platform === 'win32' ? 'echo ("TYTO_PTY_" + (40+2))\r' : 'echo TYTO_PTY_$((40+2))\r';

let scratch: string;
let app: ElectronApplication;
let page: Page;

type Bridge = Record<string, (request: unknown) => Promise<unknown>>;

function call<T>(channel: string, request: unknown): Promise<T> {
  return page.evaluate(
    ([name, body]) => (globalThis as never as { tyto: Bridge }).tyto[name as string]!(body),
    [channel, request] as const,
  ) as Promise<T>;
}

/** Collects every `terminal:output` and `terminal:exit` the page hears, from now on. */
async function listen(): Promise<void> {
  await page.evaluate(() => {
    const scope = globalThis as never as {
      tyto: { on: (event: string, listen: (payload: never) => void) => () => void };
      heard: { output: Record<string, string>; exits: { terminalId: string; code: number }[] };
    };
    scope.heard = { output: {}, exits: [] };
    scope.tyto.on('terminal:output', (payload: { terminalId: string; data: string }) => {
      scope.heard.output[payload.terminalId] =
        (scope.heard.output[payload.terminalId] ?? '') + payload.data;
    });
    scope.tyto.on('terminal:exit', (payload: { terminalId: string; code: number }) => {
      scope.heard.exits.push(payload);
    });
  });
}

const heard = (): Promise<{
  output: Record<string, string>;
  exits: { terminalId: string; code: number }[];
}> =>
  page.evaluate(
    () =>
      (globalThis as never as { heard: { output: Record<string, string>; exits: never[] } }).heard,
  );

async function open(): Promise<string> {
  const opened = await call<{ terminalId?: string; message?: string }>('terminal:open', {
    cols: 100,
    rows: 30,
  });
  expect(opened.message).toBeUndefined();
  return opened.terminalId!;
}

/** Types once the shell has printed its first output, so a slow prompt does not eat the line. */
async function typeOnceReady(terminalId: string, data: string): Promise<void> {
  await expect
    .poll(async () => (await heard()).output[terminalId] ?? '', { timeout: 20_000 })
    .not.toBe('');
  await call('terminal:input', { terminalId, data });
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-terminal-e2e-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: {
      ...process.env,
      TYTO_HEADLESS: '1',
      TYTO_HOME: join(scratch, 'tyto-home'),
      // DEBUG TYTO-497: main's timestamps around the quit. Removed before merge.
      TYTO_TERMINAL_TRACE: join(scratch, 'trace.log'),
    },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await listen();
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a terminal in the window', () => {
  it("runs the person's shell through node-pty and streams echo back", async () => {
    const terminalId = await open();

    await typeOnceReady(terminalId, ECHO);

    await expect
      .poll(async () => (await heard()).output[terminalId] ?? '', { timeout: 20_000 })
      .toContain('TYTO_PTY_42');
    await call('terminal:kill', { terminalId });
  }, 60_000);

  it('says the shell exited, with its code, when it ends on its own', async () => {
    const terminalId = await open();

    await typeOnceReady(terminalId, 'exit 3\r');

    await expect
      .poll(async () => (await heard()).exits.find((exit) => exit.terminalId === terminalId), {
        timeout: 20_000,
      })
      .toEqual({ terminalId, code: 3 });
    const { terminals } = await call<{ terminals: { terminalId: string }[] }>('terminal:list', {});
    expect(terminals.map((terminal) => terminal.terminalId)).not.toContain(terminalId);
  }, 60_000);

  it('keeps the terminal and what it printed across a reload', async () => {
    const terminalId = await open();
    await typeOnceReady(terminalId, ECHO);
    await expect
      .poll(async () => (await heard()).output[terminalId] ?? '', { timeout: 20_000 })
      .toContain('TYTO_PTY_42');

    await page.reload();
    await page.waitForSelector('#editor .cm-content');
    await listen();
    const { terminals } = await call<{ terminals: { terminalId: string; replay: string }[] }>(
      'terminal:list',
      {},
    );

    expect(terminals.find((terminal) => terminal.terminalId === terminalId)?.replay).toContain(
      'TYTO_PTY_42',
    );
    await call('terminal:kill', { terminalId });
    const after = await call<{ terminals: unknown[] }>('terminal:list', {});
    expect(after.terminals).toEqual([]);
  }, 60_000);

  it('refuses a new terminal in a restricted folder, in main, and keeps the one already open', async () => {
    const kept = await open();
    const team = join(scratch, 'equipe');
    mkdirSync(join(team, '.tyto'), { recursive: true });
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    }, team);
    const state = await call<{ trust: string }>('workspace:set-folder', { choose: true });
    expect(state.trust).toBe('restricted');

    const refused = await call<{ refused?: string; terminalId?: string }>('terminal:open', {
      cols: 80,
      rows: 24,
    });
    const { terminals } = await call<{ terminals: { terminalId: string }[] }>('terminal:list', {});

    expect(refused.refused).toBe('restricted');
    expect(refused.terminalId).toBeUndefined();
    expect(terminals.map((terminal) => terminal.terminalId)).toEqual([kept]);

    await call('workspace:trust', { trusted: true, source: 'folder' });
    const trusted = await open();
    await call('terminal:kill', { terminalId: trusted });
    await call('terminal:kill', { terminalId: kept });
  }, 60_000);

  // Last, because it quits the app; `afterAll`'s `closeApp` then finds it already down.
  it('ends every shell when the app quits (ADR 0164 decision 6)', async () => {
    const terminalId = await open();
    const typed =
      process.platform === 'win32' ? 'echo ("TYTO_PID_" + $PID)\r' : 'echo TYTO_PID_$$\r';
    await typeOnceReady(terminalId, typed);
    let printed = '';
    await expect
      .poll(
        async () => {
          printed = (await heard()).output[terminalId] ?? '';
          return /TYTO_PID_\d+/u.test(printed);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    const pid = Number(/TYTO_PID_(\d+)/u.exec(printed)![1]);
    const alive = (): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(alive()).toBe(true);
    // An idle shell asks nothing on the way out. The quit box is synchronous and nobody would
    // answer it here, so it is replaced by one that writes what it was asked and answers Quit:
    // a wrong question is then this test's assertion, not a hang.
    const asked = join(scratch, 'quit-question.txt');
    await app.evaluate((_electron, file) => {
      const { dialog } = _electron;
      const fs = process.getBuiltinModule('node:fs');
      dialog.showMessageBoxSync = ((...args: unknown[]) => {
        const options = args.at(-1) as { message?: string };
        fs.writeFileSync(file, options.message ?? '');
        return 0;
      }) as never;
    }, asked);

    // DEBUG TYTO-497: what the shell holds open and where the quit stops, on Linux CI.
    const debug = (label: string): void => {
      const lines = [`[TYTO-497 debug] ${String(Date.now())} ${label}`];
      if (process.platform === 'linux') {
        try {
          const status = readFileSync(`/proc/${String(pid)}/status`, 'utf8');
          lines.push(
            `  state ${/^State:\s*(.*)$/mu.exec(status)?.[1] ?? '?'} ppid ${/^PPid:\s*(.*)$/mu.exec(status)?.[1] ?? '?'}`,
          );
          for (const fd of readdirSync(`/proc/${String(pid)}/fd`)) {
            lines.push(`  fd ${fd} -> ${readlinkSync(`/proc/${String(pid)}/fd/${fd}`)}`);
          }
        } catch (error) {
          lines.push(`  /proc read failed: ${String(error)}`);
        }
      }
      try {
        const electron = app.process();
        lines.push(
          `  electron pid ${String(electron.pid)} exitCode ${String(electron.exitCode)} signal ${String(electron.signalCode)}`,
        );
      } catch (error) {
        lines.push(`  electron process unreadable: ${String(error)}`);
      }
      lines.push(`  shell ${String(pid)} alive ${String(alive())}`);
      const traceFile = join(scratch, 'trace.log');
      if (existsSync(traceFile)) {
        lines.push(
          ...readFileSync(traceFile, 'utf8')
            .trim()
            .split('\n')
            .map((line) => `  trace ${line}`),
        );
      }
      process.stdout.write(`${lines.join('\n')}\n`);
    };
    debug('before closeApp');
    // DEBUG TYTO-497: Electron's own stdio pipes, and later every process still holding one.
    const electronPid = app.process().pid ?? 0;
    const stdio = new Set<string>();
    if (process.platform === 'linux') {
      for (const fd of ['0', '1', '2']) {
        try {
          stdio.add(readlinkSync(`/proc/${String(electronPid)}/fd/${fd}`));
        } catch {
          // Not readable.
        }
      }
    }
    const holders = (): void => {
      if (process.platform !== 'linux') return;
      const found: string[] = [
        `[TYTO-497 debug] electron ${String(electronPid)} stdio ${[...stdio].join(' ')}`,
      ];
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/u.test(entry)) continue;
        try {
          const links = readdirSync(`/proc/${entry}/fd`).map((fd) => {
            try {
              return readlinkSync(`/proc/${entry}/fd/${fd}`);
            } catch {
              return '';
            }
          });
          const held = links.filter((link) => stdio.has(link) && link !== '/dev/null');
          if (held.length === 0) continue;
          const command = readFileSync(`/proc/${entry}/cmdline`, 'utf8')
            .replaceAll('\0', ' ')
            .slice(0, 200);
          const status = readFileSync(`/proc/${entry}/status`, 'utf8');
          const parent = /^PPid:\s*(.*)$/mu.exec(status)?.[1] ?? '?';
          const state = /^State:\s*(.*)$/mu.exec(status)?.[1] ?? '?';
          found.push(
            `  holder ${entry} ppid ${parent} state ${state} holds ${held.join(',')}: ${command}`,
          );
        } catch {
          // Gone or not ours.
        }
      }
      process.stdout.write(`${found.join('\n')}\n`);
    };
    const closed = await Promise.race([
      closeApp(app).then(() => 'closed'),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve('still closing after 30 s'), 30_000),
      ),
    ]);
    debug(closed);
    holders();
    expect(closed).toBe('closed');

    expect(existsSync(asked) ? readFileSync(asked, 'utf8') : 'not asked').toBe('not asked');

    await expect.poll(alive, { timeout: 10_000 }).toBe(false);
    process.stdout.write(`[TYTO-497] shell ${String(pid)} gone after the app quit\n`);
  }, 60_000);
});
