import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * A save failure leaves the problems panel once the next save of that tab goes through
 * (TYTO-260).
 *
 * `problems-mark.test.ts` holds the removal as values. What only a launched app answers is the
 * whole round trip on a real disk: a save-as into a folder that does not exist rejects in main,
 * the folder is then made, the same save-as writes, and the row — and the one it added to the
 * status bar's count — goes away without lighting the new-problems dot.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

const PROBLEMS = 'layout.togglePanel:problems';
const DOT = 'tyto-status-bar .status-bar__new';

let scratch: string;
let app: ElectronApplication;
let page: Page;

/** Runs a command the way the bar's Enter key does, and fails loudly if the bar refuses it. */
async function run(commandId: string): Promise<void> {
  const ran = await page.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

const click = async (command: string): Promise<void> => {
  await page.click(`tyto-status-bar [data-command="${command}"]`);
  await page.waitForTimeout(300);
};

const dotLit = (): Promise<boolean> =>
  page.evaluate((selector) => document.querySelector(selector) !== null, DOT);

const problemsShown = (): Promise<boolean> =>
  page.evaluate(() => document.querySelector('[data-panel="problems"]') !== null);

const count = (): Promise<number> =>
  page.evaluate(() =>
    Number(document.querySelector('tyto-status-bar .status-bar__count')?.textContent ?? 0),
  );

/** The codes the problems panel lists; only readable while it is on screen. */
const codes = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__code')].map((node) => node.textContent ?? ''),
  );

/**
 * Answers the next save picker with `target` and runs Save As, then waits until main was asked
 * and the answer had time to travel back. The stub counts its calls, because a second failure
 * replaces the first row and the count alone cannot say when it landed.
 */
async function saveAs(target: string): Promise<void> {
  const asked = await app.evaluate(({ dialog }, chosen) => {
    const shared = globalThis as unknown as { tytoSaveAsks?: number };
    shared.tytoSaveAsks ??= 0;
    dialog.showSaveDialog = (() => {
      shared.tytoSaveAsks = (shared.tytoSaveAsks ?? 0) + 1;
      return Promise.resolve({ canceled: false, filePath: chosen });
    }) as never;
    return shared.tytoSaveAsks;
  }, target);
  await run('editor.saveAs');
  await expect
    .poll(() =>
      app.evaluate(() => (globalThis as unknown as { tytoSaveAsks?: number }).tytoSaveAsks ?? 0),
    )
    .toBeGreaterThan(asked);
  await page.waitForTimeout(500);
}

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-save-cleared-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('tyto-status-bar .status-bar__button');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(900, 600);
  });
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a save failure, once the next save goes through', () => {
  it('leaves the panel and the count, and the dot stays dark', async () => {
    expect(await problemsShown()).toBe(true);
    const before = await count();
    const folder = join(scratch, 'not-yet');
    const target = join(folder, 'first.brief');

    await saveAs(target);
    expect(await codes()).toContain('E_SAVE_FAILED');
    expect(await count()).toBe(before + 1);
    expect(await dotLit()).toBe(false);

    // Panel off screen, so a removal that raised a row would light the dot.
    await click(PROBLEMS);
    expect(await problemsShown()).toBe(false);

    mkdirSync(folder, { recursive: true });
    await saveAs(target);
    await expect.poll(() => existsSync(target)).toBe(true);
    await expect.poll(count).toBe(before);
    expect(await dotLit()).toBe(false);

    await click(PROBLEMS);
    expect(await codes()).not.toContain('E_SAVE_FAILED');
  });

  it('puts out a dot the failure lit, since there is nothing left for it to point at', async () => {
    // Not assumed from the case above, so a red there does not turn this one red too.
    if (await problemsShown()) await click(PROBLEMS);
    expect(await problemsShown()).toBe(false);
    const before = await count();
    const folder = join(scratch, 'later');
    const target = join(folder, 'second.brief');

    await saveAs(target);
    expect(await dotLit()).toBe(true);
    expect(await count()).toBe(before + 1);

    mkdirSync(folder, { recursive: true });
    await saveAs(target);
    await expect.poll(() => existsSync(target)).toBe(true);
    await expect.poll(count).toBe(before);
    expect(await dotLit()).toBe(false);

    await click(PROBLEMS);
    expect(await codes()).not.toContain('E_SAVE_FAILED');
  });
});
