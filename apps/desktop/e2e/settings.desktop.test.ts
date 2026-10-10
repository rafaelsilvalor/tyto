import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * `settings.json` as a tab, in a running app (TYTO-206, ADR 0073).
 *
 * **What the unit suites cannot say.** `settings-live.test.ts` drives the three writers against
 * a real file with the watcher played by the test, and nothing there proves the watcher is
 * wired, that the tab saves to the right file, or that a problem reaches the problems panel at
 * the key it is about. This walks the route a person takes: the command bar, the tab, a save,
 * and the queue applying the change with no restart.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139): the settings file is the subject, and
 * the machine's own must never be the one opened, written or watched.
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
}

async function launch(scratch: string, settings?: string): Promise<Launched> {
  const userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  if (settings !== undefined) writeFileSync(join(userData, 'settings.json'), settings, 'utf8');
  const app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  const page = await firstWindow(app);
  // Something the script builds, never the markup it shipped with (TYTO-154).
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  return { app, page, userData };
}

/** Ctrl+K, the command's id, Enter — the way a person opens the settings. */
async function openSettingsFromBar(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type('settings.open');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.tabs__tab')].some((tab) =>
      (tab.textContent ?? '').includes('settings.json'),
    ),
  );
}

/** Replaces the whole buffer in front, as typing over it would. */
async function typeOver(page: Page, text: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
}

const autoRun = (page: Page): Promise<boolean> =>
  page.evaluate(async () => {
    const bridge = (
      window as unknown as { tyto: { 'queue:list': (r: object) => Promise<{ autoRun: boolean }> } }
    ).tyto;
    return (await bridge['queue:list']({})).autoRun;
  });

/** The problems panel's rows as `code@line:column`. */
const problems = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__row')].map(
      (row) =>
        `${row.querySelector('.problems__code')?.textContent ?? ''}@${row.querySelector('.problems__where')?.textContent ?? ''}`,
    ),
  );

const reloads = (userData: string): number => {
  const log = join(userData, 'logs', 'tyto.log');
  if (!existsSync(log)) return 0;
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line.includes('settings.json changed on disk')).length;
};

async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('the settings tab', () => {
  let scratch: string;
  let launched: Launched;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'tyto-settings-e2e-'));
    launched = await launch(scratch);
  });

  afterAll(async () => {
    await closeApp(launched.app);
    rmSync(scratch, { recursive: true, force: true });
  });

  it('opens from the command bar, creating the file it opens', async () => {
    await openSettingsFromBar(launched.page);
    const file = join(launched.userData, 'settings.json');
    expect(existsSync(file)).toBe(true);
    expect(
      await launched.page.evaluate(
        () => document.querySelector('#editor .cm-content')?.textContent ?? '',
      ),
    ).toContain('Tyto settings');
  });

  it('applies a saved change with no restart', async () => {
    const { page, userData } = launched;
    expect(await autoRun(page)).toBe(false);

    await typeOver(page, '{\n  "queueAutoRun": true\n}\n');
    await page.keyboard.press('Control+s');

    await waitFor(() => autoRun(page), 'queueAutoRun to apply');
    expect(JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))).toEqual({
      queueAutoRun: true,
    });
    await waitFor(() => Promise.resolve(reloads(userData) === 1), 'one reload in the log');
  });

  it("does not reload on the app's own write", async () => {
    const { page, userData } = launched;
    const before = reloads(userData);

    await page.evaluate(async () => {
      const bridge = (
        window as unknown as { tyto: { 'queue:set-auto-run': (r: object) => Promise<unknown> } }
      ).tyto;
      await bridge['queue:set-auto-run']({ on: false });
    });
    // Longer than the watcher's settle time, several times over.
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(readFileSync(join(userData, 'settings.json'), 'utf8')).not.toContain('queueAutoRun');
    expect(reloads(userData)).toBe(before);
    // The clean tab followed the screen's write, and stayed clean.
    expect(
      await page.evaluate(() => document.querySelector('#editor .cm-content')?.textContent ?? ''),
    ).not.toContain('queueAutoRun');
  });

  it("puts a screen's change into unsaved typing, and leaves the disk alone", async () => {
    const { page, userData } = launched;
    const onDisk = readFileSync(join(userData, 'settings.json'), 'utf8');
    await typeOver(page, '{\n  // typing, not saved\n}\n');
    // The tab's state reaches main on the preview's pause.
    await new Promise((resolve) => setTimeout(resolve, 600));

    await page.evaluate(async () => {
      const bridge = (
        window as unknown as { tyto: { 'queue:set-auto-run': (r: object) => Promise<unknown> } }
      ).tyto;
      await bridge['queue:set-auto-run']({ on: true });
    });

    const buffer = (): Promise<string> =>
      page.evaluate(() => document.querySelector('#editor .cm-content')?.textContent ?? '');
    await waitFor(async () => (await buffer()).includes('"queueAutoRun": true'), 'the buffer edit');
    expect(await buffer()).toContain('// typing, not saved');
    expect(readFileSync(join(userData, 'settings.json'), 'utf8')).toBe(onDisk);
  });

  it('shows a misspelt key in the problems panel, at the key', async () => {
    const { page } = launched;
    await typeOver(page, '{\n  "queueAutRun": true\n}\n');

    await waitFor(
      async () => (await problems(page)).includes('W_SETTING_UNKNOWN@2:3'),
      `W_SETTING_UNKNOWN at 2:3, the panel shows ${JSON.stringify(await problems(page))}`,
    );
  });
});

describe('a settings file that does not parse', () => {
  const BROKEN = '{\n  "queueAutoRun": false\n  "queueFolder": null\n';
  let scratch: string;
  let launched: Launched;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'tyto-settings-broken-e2e-'));
    launched = await launch(scratch, BROKEN);
  });

  afterAll(async () => {
    await closeApp(launched.app);
    rmSync(scratch, { recursive: true, force: true });
  });

  it('opens a working window and leaves the file as it was', () => {
    expect(readFileSync(join(launched.userData, 'settings.json'), 'utf8')).toBe(BROKEN);
  });

  it("refuses a screen's change, goes back, and shows why at the error", async () => {
    const { page, userData } = launched;
    await page.evaluate(async () => {
      const bridge = (
        window as unknown as { tyto: { 'queue:set-auto-run': (r: object) => Promise<unknown> } }
      ).tyto;
      await bridge['queue:set-auto-run']({ on: true });
    });

    expect(await autoRun(page)).toBe(false);
    expect(readFileSync(join(userData, 'settings.json'), 'utf8')).toBe(BROKEN);
    await waitFor(
      async () => (await problems(page)).some((row) => row.startsWith('E_SETTINGS_SYNTAX@3:')),
      'E_SETTINGS_SYNTAX in the problems panel',
    );
  });
});
