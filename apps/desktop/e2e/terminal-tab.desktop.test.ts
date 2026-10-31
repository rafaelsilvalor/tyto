import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The Terminal tab in the real window (TYTO-497, ADR 0164 decision 7 and 8): the card's
 * acceptance, a terminal opened from the keyboard where `echo` is typed and its answer is read
 * off xterm's screen. Only what needs the window: Electron's keys reaching xterm, xterm drawing,
 * and the window's own keys handed back from inside a terminal. The panel's logic is
 * `terminal-panel.test.ts` and `terminal-sessions.test.ts`; main's, `terminal.desktop.test.ts`.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}

/** Computed by the shell, so the marker never appears in the typed text. */
const ECHO =
  process.platform === 'win32' ? 'echo ("TYTO_TAB_" + (40+2))' : 'echo TYTO_TAB_$((40+2))';

let scratch: string;
let app: ElectronApplication;
let page: Page;

/** What the terminal in front shows, row by row, as xterm drew it. */
const screen = (): Promise<string> =>
  page.evaluate(
    () =>
      document.querySelector('.terminal-panel__screens .terminal-screen:not([hidden]) .xterm-rows')
        ?.textContent ?? '',
  );

const focusInTerminal = (): Promise<boolean> =>
  page.evaluate(() => document.activeElement?.closest('.terminal-panel__screens') != null);

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-terminal-tab-e2e-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the Terminal tab', () => {
  it('opens on Ctrl+Shift+`, runs echo typed into it, and draws the answer', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+Shift+Backquote');

    await page.waitForSelector('.terminal-panel__screens .xterm', { timeout: 20_000 });
    await page.waitForFunction(
      () => document.activeElement?.closest('.terminal-panel__screens') != null,
      undefined,
      { timeout: 10_000 },
    );
    // The prompt first, so the typed line is not eaten by a shell still starting.
    await expect.poll(screen, { timeout: 20_000 }).toMatch(/\S/u);
    await page.keyboard.type(ECHO);
    await page.keyboard.press('Enter');

    await expect.poll(screen, { timeout: 20_000 }).toContain('TYTO_TAB_42');
    const tab = await page.getAttribute('.dock-tab[data-tab="terminal"]', 'aria-selected');
    expect(tab).toBe('true');
  }, 60_000);

  it("hands the window's keys back from inside a terminal: Ctrl+K opens the command bar", async () => {
    expect(await focusInTerminal()).toBe(true);

    await page.keyboard.press('Control+K');

    await page.waitForFunction(
      () =>
        (document.querySelector('tyto-command-bar') as { open?: boolean } | null)?.open === true,
      undefined,
      { timeout: 10_000 },
    );
    await page.keyboard.press('Escape');
  });

  it('leaves Ctrl+` on the command panel', async () => {
    await page.keyboard.press('Control+Backquote');

    await page.waitForFunction(
      () =>
        document.querySelector('.dock-tab[data-tab="commands"]')?.getAttribute('aria-selected') ===
        'true',
      undefined,
      { timeout: 10_000 },
    );
  });
});
