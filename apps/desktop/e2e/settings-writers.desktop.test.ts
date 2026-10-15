import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The three ways a settings edit could still be lost with the settings tab open (TYTO-255,
 * ADR 0073 decision 8). Each was reproduced red here before the fix.
 *
 * 1. A screen's change inside the pause before main hears the tab is dirty: main wrote it to
 *    disk, the window dropped it over the typing, and the next save erased it.
 * 2. Another editor's save while the tab is dirty: the typing was kept, and the next save
 *    erased the other editor's change.
 * 3. A screen's change put into a dirty tab that is then closed without saving: the session
 *    kept the value, the file never got it.
 *
 * One app per case, each with its own `--user-data-dir` and `TYTO_HOME` (TYTO-139): the
 * settings file is the subject, and a case must not start from another's leftovers.
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
  readonly userData: string;
  readonly scratch: string;
}

async function launch(): Promise<Launched> {
  const scratch = mkdtempSync(join(tmpdir(), 'tyto-settings-writers-e2e-'));
  const userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  const app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  const page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  return { app, page, userData, scratch };
}

async function openSettings(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type('settings.open');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.tabs__tab')].some((tab) =>
      (tab.textContent ?? '').includes('settings.json'),
    ),
  );
  await page.waitForFunction(() =>
    (document.querySelector('#editor .cm-content')?.textContent ?? '').includes('Tyto settings'),
  );
}

/** One line typed at the top of the buffer: the person's unsaved edit. */
async function typeAtTop(page: Page, line: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+Home');
  await page.keyboard.insertText(line);
}

/** The queue panel's switch, as a screen sets it: `settings.json` through `remember`. */
const setAutoRun = (page: Page, on: boolean): Promise<unknown> =>
  page.evaluate(async (value) => {
    const bridge = (
      window as unknown as { tyto: { 'queue:set-auto-run': (r: object) => Promise<unknown> } }
    ).tyto;
    return bridge['queue:set-auto-run']({ on: value });
  }, on);

const autoRun = (page: Page): Promise<boolean> =>
  page.evaluate(async () => {
    const bridge = (
      window as unknown as { tyto: { 'queue:list': (r: object) => Promise<{ autoRun: boolean }> } }
    ).tyto;
    return (await bridge['queue:list']({})).autoRun;
  });

const buffer = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector('#editor .cm-content')?.textContent ?? '');

const onDisk = (userData: string): string => readFileSync(join(userData, 'settings.json'), 'utf8');

async function waitFor(condition: () => Promise<boolean> | boolean, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('a settings edit is never lost', () => {
  let launched: Launched;

  beforeEach(async () => {
    launched = await launch();
    await openSettings(launched.page);
  });

  afterEach(async () => {
    await closeApp(launched.app);
    rmSync(launched.scratch, { recursive: true, force: true });
  });

  it("keeps a screen's change made in the pause before main hears of the typing", async () => {
    const { page, userData } = launched;
    // The keystroke and the screen's change in one breath: well inside the 200 ms pause
    // after which the window tells main that the tab is dirty.
    await typeAtTop(page, '// mine\n');
    await setAutoRun(page, true);
    await waitFor(async () => autoRun(page), 'queueAutoRun to apply');
    // The window has heard the screen's write before the person saves.
    await new Promise((resolve) => setTimeout(resolve, 500));

    await page.keyboard.press('Control+s');
    await waitFor(() => onDisk(userData).includes('// mine'), 'the typing on disk');
    const text = onDisk(userData);
    expect(text).toContain('// mine');
    expect(text).toContain('"queueAutoRun": true');
  });

  it("keeps another editor's save made while the tab is dirty", async () => {
    const { page, userData } = launched;
    await typeAtTop(page, '// mine\n');
    // Main hears the tab is dirty on the preview's pause.
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Before the closing brace: a new file holds a commented example inside it (TYTO-301).
    const outside = onDisk(userData).replace(/\n\}\s*$/u, '\n  "queueAutoRun": true\n}\n');
    expect(outside).toContain('"queueAutoRun": true');
    writeFileSync(join(userData, 'settings.json'), outside, 'utf8');
    await waitFor(async () => autoRun(page), 'the outside save to apply');
    await new Promise((resolve) => setTimeout(resolve, 500));

    await page.keyboard.press('Control+s');
    await waitFor(() => onDisk(userData).includes('// mine'), 'the typing on disk');
    const text = onDisk(userData);
    expect(text).toContain('// mine');
    expect(text).toContain('"queueAutoRun": true');
  });

  it("writes a screen's change to disk when the dirty tab closes without saving", async () => {
    const { app, page, userData } = launched;
    await typeAtTop(page, '// mine\n');
    await new Promise((resolve) => setTimeout(resolve, 600));

    await setAutoRun(page, true);
    await waitFor(async () => (await buffer(page)).includes('"queueAutoRun": true'), 'the buffer');
    expect(onDisk(userData)).not.toContain('queueAutoRun');

    // The discard question, answered "close without saving" from main's own dialog.
    await app.evaluate(({ dialog }) => {
      const seen: string[] = [];
      (globalThis as unknown as { asked: string[] }).asked = seen;
      dialog.showMessageBox = ((...args: unknown[]) => {
        const box = args.at(-1) as { detail?: string };
        seen.push(box.detail ?? '');
        return Promise.resolve({ response: 1, checkboxChecked: false });
      }) as typeof dialog.showMessageBox;
    });
    await page.keyboard.press('Control+w');
    await waitFor(
      () =>
        page.evaluate(
          () =>
            ![...document.querySelectorAll('.tabs__tab')].some((tab) =>
              (tab.textContent ?? '').includes('settings.json'),
            ),
        ),
      'the settings tab to close',
    );

    await waitFor(() => onDisk(userData).includes('queueAutoRun'), "the screen's change on disk");
    const text = onDisk(userData);
    expect(text).toContain('"queueAutoRun": true');
    expect(text).not.toContain('// mine');
    expect(await autoRun(page)).toBe(true);
    // The question said so: only the typing goes.
    const asked = await app.evaluate(() => (globalThis as unknown as { asked: string[] }).asked);
    expect(asked).toEqual([expect.stringContaining('screens are kept')]);
  });
});
