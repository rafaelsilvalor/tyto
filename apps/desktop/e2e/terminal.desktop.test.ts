import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
    // Nothing asks on the way out: an idle shell raises no quit question, and a crash in main
    // raises its box. Both boxes are synchronous and nobody answers them here, which is how this
    // test hung on Linux CI before (a crash box, once a late shell exit reached a destroyed
    // window). So each box is replaced by one that writes what it was asked, message and detail,
    // and answers its cancel button; the close gets 20 s, and a box is then the failure, with its
    // text, instead of a hang.
    const asked = join(scratch, 'boxes.txt');
    await app.evaluate((electronModule, file) => {
      const { dialog } = electronModule;
      const fs = process.getBuiltinModule('node:fs');
      dialog.showMessageBoxSync = ((...args: unknown[]) => {
        const options = args.at(-1) as { message?: string; detail?: string; cancelId?: number };
        fs.appendFileSync(file, `${options.message ?? ''} | ${options.detail ?? ''}\n`);
        return options.cancelId ?? 0;
      }) as never;
    }, asked);

    const closed = await Promise.race([
      closeApp(app).then(() => 'closed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('not closed after 20 s'), 20_000)),
    ]);

    expect(existsSync(asked) ? readFileSync(asked, 'utf8') : 'nothing asked').toBe('nothing asked');
    expect(closed).toBe('closed');
    await expect.poll(alive, { timeout: 10_000 }).toBe(false);
    process.stdout.write(`[TYTO-497] shell ${String(pid)} gone after the app quit\n`);
  }, 60_000);
});
