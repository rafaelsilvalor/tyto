import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The page's own `window.close()` goes through the same latch as the X button (TYTO-250).
 *
 * Before this card it fired no `close` on the window — `closed → before-quit → will-quit` — so
 * the session's final write never ran: a draft typed 100 ms before the close was lost 3 of 3,
 * and only the one-second pause write ever saved one. The arms here are that close, the X
 * button it must not break, a reload of either kind that must stay a reload, and the settings
 * tab, whose screens' changes reach the file only through the final write.
 *
 * Each arm gets its own `--user-data-dir` and `TYTO_HOME` (TYTO-139), and a relaunch reuses
 * them: the second launch is how a draft is proved kept. A box drawn by any launch is written
 * to a file, since hot exit asks nothing and a box here is a failure of its own.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

interface Launched {
  readonly app: ElectronApplication;
  readonly page: Page;
}

let scratch: string | undefined;
let running: ElectronApplication | undefined;

const userDataOf = (folder: string): string => join(folder, 'userData');
const boxesOf = (folder: string): string => join(folder, 'boxes.txt');

async function launch(folder: string): Promise<Launched> {
  const app = await _electron.launch({
    args: ['.', `--user-data-dir=${userDataOf(folder)}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(folder, 'tyto-home') },
  });
  running = app;
  const page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  await app.evaluate(({ dialog }, file) => {
    dialog.showMessageBox = ((options: { message?: string }): Promise<unknown> => {
      const fs = process.getBuiltinModule('node:fs');
      fs.appendFileSync(file, `${options.message ?? ''}\n`);
      return Promise.resolve({ response: 1, checkboxChecked: false });
    }) as never;
  }, boxesOf(folder));
  return { app, page };
}

async function runFromBar(page: Page, id: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
}

/** A new untitled tab with `text` typed into it, as a person would. */
async function draft(page: Page, text: string): Promise<void> {
  await runFromBar(page, 'document.new');
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

/**
 * The page closes itself. Off a timer so the evaluate returns before the window goes, and
 * 50 ms so the close lands well inside the one-second pause after which the session is kept
 * anyway — the window the old code lost.
 */
const closeFromThePage = (page: Page): Promise<void> =>
  page.evaluate(() => {
    setTimeout(() => {
      window.close();
    }, 50);
  });

/** Resolves once the app has quit, or fails naming what it waited for. */
async function quitWithin(app: ElectronApplication, what: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`the app did not quit within 30 s after ${what}`));
    }, 30_000);
  });
  try {
    await Promise.race([app.waitForEvent('close'), late]);
  } finally {
    clearTimeout(timer);
  }
  running = undefined;
}

const editorText = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector('#editor .cm-content')?.textContent ?? '');

/** Relaunches the same folders and waits for the restored draft to be the tab in front. */
async function relaunchShowing(folder: string, text: string): Promise<string> {
  const { page } = await launch(folder);
  await page
    .waitForFunction(
      (wanted) =>
        (document.querySelector('#editor .cm-content')?.textContent ?? '').includes(wanted),
      text,
      { timeout: 30_000 },
    )
    .catch(() => undefined);
  return editorText(page);
}

const newScratch = (): string => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-page-close-'));
  return scratch;
};

afterEach(async () => {
  await closeApp(running);
  running = undefined;
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe("the page's own window.close()", () => {
  it('keeps a draft typed just before it, through the final session write', async () => {
    const folder = newScratch();
    const { app, page } = await launch(folder);

    await draft(page, '::titulo Fechou pela pagina');
    await closeFromThePage(page);
    await quitWithin(app, 'window.close()');

    expect(await relaunchShowing(folder, 'Fechou pela pagina')).toContain(
      '::titulo Fechou pela pagina',
    );
    expect(existsSync(boxesOf(folder))).toBe(false);
  }, 180_000);

  it("writes the settings tab's pending screen change to the file", async () => {
    const folder = newScratch();
    const { app, page } = await launch(folder);
    const settingsFile = join(userDataOf(folder), 'settings.json');

    await runFromBar(page, 'settings.open');
    await page.waitForFunction(() =>
      (document.querySelector('#editor .cm-content')?.textContent ?? '').includes('Tyto settings'),
    );
    // The tab is dirty, so a screen's change goes into its buffer and not to the disk
    // (ADR 0073 decision 8); only the final write carries it to the file.
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+Home');
    await page.keyboard.insertText('// mine\n');
    await page.waitForTimeout(600);
    await page.evaluate(async () => {
      const bridge = (
        window as unknown as { tyto: { 'queue:set-auto-run': (r: object) => Promise<unknown> } }
      ).tyto;
      await bridge['queue:set-auto-run']({ on: true });
    });
    await page.waitForFunction(() =>
      (document.querySelector('#editor .cm-content')?.textContent ?? '').includes(
        '"queueAutoRun": true',
      ),
    );
    expect(readFileSync(settingsFile, 'utf8')).not.toContain('queueAutoRun');

    await closeFromThePage(page);
    await quitWithin(app, 'window.close() with the settings tab dirty');

    expect(readFileSync(settingsFile, 'utf8')).toContain('"queueAutoRun": true');
    expect(existsSync(boxesOf(folder))).toBe(false);
  }, 180_000);
});

describe('the doors that were already there', () => {
  it('still quits from the X button and keeps the draft', async () => {
    const folder = newScratch();
    const { app, page } = await launch(folder);

    await draft(page, '::titulo Fechou pelo X');
    // `BrowserWindow.close()` runs the page's `beforeunload` after `close` was granted; a veto
    // nobody overruled would leave the window standing here.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await quitWithin(app, 'BrowserWindow.close()');

    expect(await relaunchShowing(folder, 'Fechou pelo X')).toContain('::titulo Fechou pelo X');
    expect(existsSync(boxesOf(folder))).toBe(false);
  }, 180_000);

  it('reloads, and does not quit, on a reload main starts and on one the page starts', async () => {
    const folder = newScratch();
    const { app, page } = await launch(folder);
    await draft(page, '::titulo Recarregou');

    // Main's kind: DevTools' reload and `page.reload()` are the same request.
    await page.evaluate(() => {
      (window as unknown as { before: boolean }).before = true;
    });
    await page.reload();
    await page.waitForSelector('#editor .cm-content');
    expect(await page.evaluate(() => 'before' in window)).toBe(false);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    // The page's kind: `Mod-r` is `location.reload()` once the session is written.
    await page.waitForSelector('.tabs__tab');
    await page.evaluate(() => {
      (window as unknown as { before: boolean }).before = true;
    });
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+r');
    await page.waitForFunction(() => !('before' in window), null, { timeout: 30_000 });
    await page.waitForSelector('#editor .cm-content');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    expect(existsSync(boxesOf(folder))).toBe(false);
  }, 180_000);
});
