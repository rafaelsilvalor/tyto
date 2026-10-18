import { join } from 'node:path';

import { type Browser, type Page, chromium } from 'playwright';

import { readPortFile } from './port-file.js';

/** The switch that makes a booted app say so: Chromium writes `DevToolsActivePort` once it listens. */
export const DEBUGGING_PORT_SWITCH = '--remote-debugging-port=0';

/** A window's page with the editor in it, and the connection that reached it. */
export interface Booted {
  readonly browser: Browser;
  readonly page: Page;
}

export interface BootWatch {
  /** The data folder the app was given, where Chromium writes `DevToolsActivePort`. */
  readonly userData: string;
  /** Whether the process has already ended, which no amount of waiting turns into a boot. */
  readonly gone: () => boolean;
  /** The last of its stderr, for the error that says why it never booted. */
  readonly stderrTail: () => string;
  readonly deadlineMs: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Every page target the browser has, which is every window's page. */
export function windowPages(browser: Browser): Page[] {
  return browser.contexts().flatMap((context) => context.pages());
}

/**
 * Wait until an app started with {@link DEBUGGING_PORT_SWITCH} has a window with the editor in
 * it, and throw if it ends or the deadline passes first (TYTO-308, ADR 0103).
 *
 * **What "booted" means, everywhere in the packaged suites.** The CDP harness waits for this
 * before handing a page to a test, and the launch probes end on it instead of waiting out a
 * fixed deadline: a process that is merely still running might be stuck before the window, and
 * a window with the editor is the app having started. The editor and not the bridge (TYTO-175):
 * `window.tyto` is on the page before a line of the renderer has run.
 *
 * The connection is the caller's to close; on a throw nothing is left open.
 */
export async function waitForBoot(watch: BootWatch): Promise<Booted> {
  const portFile = join(watch.userData, 'DevToolsActivePort');
  const started = Date.now();
  const check = (what: string): void => {
    if (watch.gone()) {
      throw new Error(`the app exited before ${what}: ${watch.stderrTail().slice(-400)}`);
    }
    if (Date.now() - started > watch.deadlineMs) {
      throw new Error(`no ${what} within ${String(watch.deadlineMs)} ms`);
    }
  };
  // `DevToolsActivePort` first, then the window, each against the same clock. Two lines, port
  // and path: Chromium writes the file in one go, but a read can land between
  // the create and the write.
  let lines: string[] | undefined;
  while ((lines = readPortFile(portFile)) === undefined) {
    check('DevToolsActivePort');
    await sleep(50);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${lines[0]!}`);
  try {
    let page: Page | undefined;
    while ((page = windowPages(browser)[0]) === undefined) {
      check('window');
      await sleep(50);
    }
    // Its own budget, as `launchOverCdp` always gave it. A probe does not wait that long: its
    // deadline kills the tree, which closes the page and ends this wait.
    await page.waitForSelector('#editor .cm-content', { timeout: watch.deadlineMs });
    return { browser, page };
  } catch (cause) {
    await browser.close().catch(() => {
      // Already disconnected by the app ending.
    });
    throw cause;
  }
}
