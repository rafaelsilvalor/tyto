import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { type Browser, type Page, chromium } from 'playwright';

import { FIRST_WINDOW_TIMEOUT_MS } from './first-window.js';
import { appSwitches, killTree } from './run-as-node-probe.js';

/**
 * An app driven over the Chrome DevTools Protocol instead of Playwright's `_electron` (TYTO-249).
 *
 * **Why the packaged suite cannot use `_electron` any more.** `_electron.launch` passes
 * `--inspect=0` and waits for Node's `Debugger listening on` line, which only an executable
 * whose `EnableNodeCliInspectArguments` fuse is on ever prints. That fuse is what let a local
 * program run code in main, and ADR 0067 switches it off. `--remote-debugging-port` is a
 * Chromium switch that no fuse gates, and it reaches the window's page and its bridge, which
 * is everything the packaged suite asks.
 *
 * **What is lost is main.** `app.evaluate` ran code in the main process, and over CDP there is
 * no main to run it in. The one place the packaged suite used it was `closeApp`'s stub for the
 * quit box; see {@link closeOverCdp} for why it is not missed.
 */
export interface CdpApp {
  readonly browser: Browser;
  /** The window's page, already past `#editor .cm-content`. */
  readonly page: Page;
  readonly child: ChildProcess;
  /** Resolves when the process has exited, with how. Settled once, read as often as needed. */
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** The last of what it wrote to stderr, for an error that has to say why. */
  stderrTail: () => string;
}

export interface CdpLaunchOptions {
  readonly userData: string;
  readonly home: string;
  /** After the switches: the app folder, for an Electron that is not the packaged one. */
  readonly arguments?: readonly string[];
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Start `executable` as the app with a debugging port, and connect to its window.
 *
 * Isolated the way every launch here is (TYTO-139): its own `--user-data-dir` and `TYTO_HOME`
 * are required parameters, and the switches come before anything else, never behind a `--`
 * (ADR 0067). `launch-isolation.test.ts` reads `_electron.launch` calls only, so the types are
 * what keeps this one honest.
 *
 * The port is `0` and read back out of `DevToolsActivePort`, which Chromium writes into the
 * data folder once it listens, so two suites can never collide on a number.
 */
export async function launchOverCdp(
  executable: string,
  options: CdpLaunchOptions,
): Promise<CdpApp> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    TYTO_HEADLESS: '1',
    TYTO_HOME: options.home,
  };
  // What Playwright's `_electron` did for the same reason: what the runner put there is not
  // part of the question, and the packaged app no longer reads it anyway (ADR 0067).
  delete environment['NODE_OPTIONS'];
  delete environment['ELECTRON_RUN_AS_NODE'];

  const child = spawn(
    executable,
    [...appSwitches(options.userData), '--remote-debugging-port=0', ...(options.arguments ?? [])],
    {
      env: environment,
      stdio: ['ignore', 'ignore', 'pipe'],
      // Its own process group on POSIX, so one signal reaches every child it started.
      detached: process.platform !== 'win32',
    },
  );
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-2_000);
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
  let gone = false;
  void exited.then(() => {
    gone = true;
  });

  try {
    const portFile = join(options.userData, 'DevToolsActivePort');
    const started = Date.now();
    const deadline = (what: string): void => {
      if (gone) throw new Error(`the app exited before ${what}: ${stderr.slice(-400)}`);
      if (Date.now() - started > FIRST_WINDOW_TIMEOUT_MS) {
        throw new Error(`no ${what} within ${String(FIRST_WINDOW_TIMEOUT_MS)} ms`);
      }
    };
    // Two lines, port and path: Chromium writes the file in one go, but a read can land
    // between the create and the write.
    while (!existsSync(portFile) || readFileSync(portFile, 'utf8').split('\n').length < 2) {
      deadline('DevToolsActivePort');
      await sleep(50);
    }
    const port = readFileSync(portFile, 'utf8').split('\n')[0]!;
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);

    let page: Page | undefined;
    while ((page = windowPages(browser)[0]) === undefined) {
      deadline('window');
      await sleep(50);
    }
    // The editor and not the bridge (TYTO-175): see the packaged suite's `beforeAll`.
    await page.waitForSelector('#editor .cm-content', { timeout: FIRST_WINDOW_TIMEOUT_MS });

    return { browser, page, child, exited, stderrTail: () => stderr };
  } catch (cause) {
    killTree(child.pid);
    throw cause;
  }
}

/** Every page target the browser has, which is every window's page. */
export function windowPages(browser: Browser): Page[] {
  return browser.contexts().flatMap((context) => context.pages());
}

/**
 * Ask the app to quit the way a person does, through the quit guard (ADR 0031, ADR 0039).
 *
 * **Measured before it was chosen.** On Electron 44 with a dirty tab, CDP `Browser.close` left
 * the app running at 10 s, held by the quit question, and with a clean tab it exited with code 0
 * in 85 ms. So it reaches `before-quit` or the window's `close`, and the guard asks the page.
 * A page's own `window.close()` did not: with the same dirty tab the app exited in 93 ms. That
 * is why the harness quits with this and not with something shorter, and why the packaged suite
 * has a test that a dirty tab holds this exact call.
 *
 * Not awaited: the browser ends before it answers, and Playwright's promise never settles.
 */
export async function requestQuit(app: CdpApp): Promise<void> {
  const session = await app.browser.newBrowserCDPSession();
  void session;
  void app.page
    .evaluate(() => window.close())
    .catch(() => {
      // The connection closes with the browser. That is the answer, not an error.
    });
}

/** How a deadline-bounded wait for the process ended. */
export type Ending =
  | { readonly ended: 'exited'; readonly code: number | null; readonly ms: number }
  | { readonly ended: 'still running'; readonly ms: number };

/** Wait up to `deadlineMs` for the process to end, without killing it. */
export async function waitForExit(app: CdpApp, deadlineMs: number): Promise<Ending> {
  const started = Date.now();
  const timeout = new Promise<'still running'>((resolve) => {
    setTimeout(() => {
      resolve('still running');
    }, deadlineMs).unref();
  });
  const outcome = await Promise.race([app.exited, timeout]);
  const ms = Date.now() - started;
  return outcome === 'still running'
    ? { ended: 'still running', ms }
    : { ended: 'exited', code: outcome.code, ms };
}

/**
 * Processes left in the app's process group, once it has been killed (Linux only).
 *
 * `killTree` signals the group, and a Chromium child that survived it would hold the CI job open
 * long after the test said it was done. Read out of `/proc` rather than assumed; zombies are
 * not counted, since they hold nothing and are reaped by their new parent. Polled for up to 5 s,
 * because a signal is delivered, not obeyed, at the moment it is sent. `undefined` on Windows
 * and macOS, where this is not measured.
 */
export async function survivorsOf(pid: number | undefined): Promise<number[] | undefined> {
  if (process.platform !== 'linux' || pid === undefined) return undefined;
  const members = (): number[] =>
    readdirSync('/proc')
      .filter((entry) => /^\d+$/u.test(entry))
      .flatMap((entry) => {
        try {
          const stat = readFileSync(join('/proc', entry, 'stat'), 'utf8');
          // `pid (comm) state ppid pgrp …`; `comm` may hold spaces and parentheses.
          const [state, , group] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
          return Number(group) === pid && state !== 'Z' ? [Number(entry)] : [];
        } catch {
          return [];
        }
      });
  const started = Date.now();
  let left = members();
  while (left.length > 0 && Date.now() - started < 5_000) {
    await sleep(100);
    left = members();
  }
  return left;
}

/**
 * Quit a CDP app through the quit guard, and fail by name if the guard holds it (TYTO-249).
 *
 * **This replaces `closeApp` for the packaged suite, without its stub, and the stub is not
 * missed.** `closeApp` answers the quit box from main with `app.evaluate`, which needs the
 * inspector this card switches off. No packaged test ever opens or edits a tab: they speak to
 * main through the bridge, and the window keeps the untitled document it starts with, which is
 * clean (ADR 0026). So the guard asks the page, the page answers at once, and no box is drawn.
 *
 * If a later test does leave text behind, the box holds the app, and the 30 s deadline (the
 * quit guard's own acknowledgement deadline, ADR 0031) ends the wait with an error that says
 * so, the process tree killed first, instead of the hook's 600 s. A test-only switch in the
 * shipped binary to answer the box would buy nothing the packaged suite uses.
 */
export async function closeOverCdp(app: CdpApp | undefined, deadlineMs = 30_000): Promise<Ending> {
  if (app === undefined) return { ended: 'exited', code: null, ms: 0 };
  await requestQuit(app);
  const ending = await waitForExit(app, deadlineMs);
  await app.browser.close().catch(() => {
    // Already disconnected by the browser ending.
  });
  if (ending.ended === 'still running') {
    killTree(app.child.pid);
    const left = await survivorsOf(app.child.pid);
    throw new Error(
      `the quit guard held the app for ${String(deadlineMs)} ms after Browser.close: is a tab ` +
        `unsaved? The process tree was killed (survivors: ${JSON.stringify(left ?? 'not measured')}).`,
    );
  }
  return ending;
}
