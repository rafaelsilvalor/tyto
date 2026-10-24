import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The `vimMode` setting across a restart, through the real window (TYTO-333).
 *
 * `vim-setting.test.ts` holds the window's rule and `vim-mode-setting.test.ts` the file. What
 * only a running app can say is that the command's write reaches `settings.json` through main,
 * that a relaunch reads it before the window decides its mode, and that a hand edit of the file
 * reaches an open window through the watcher. This walks that route with the status bar's vim
 * badge as the witness: it is drawn only while vim is on.
 *
 * Every launch has its own `--user-data-dir` and `TYTO_HOME` (TYTO-139), the same pair across
 * the relaunches, since the file they share is the subject. The theme is fixed by the setting
 * so the window's background says when main's settings answer has landed: before it, a badge
 * that is absent proves nothing.
 *
 * With `TYTO_VIM_SETTING_SHOTS` set to a folder, the suite leaves a picture of the window after
 * the relaunch with vim on, `vim-on-after-relaunch.png`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_VIM_SETTING_SHOTS'];

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

const BADGE = 'tyto-status-bar .status-bar__vim';

/** Tyto Light's surface, as `getComputedStyle` reports it. */
const lightSurface = (): string => {
  const file = join(here, '..', 'src', 'main', 'themes', 'tyto-light.json');
  const hex = (JSON.parse(readFileSync(file, 'utf8')) as { colors: Record<string, string> }).colors[
    'surface'
  ]!;
  const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
};

describe('the vimMode setting across a restart', () => {
  let scratch: string;
  let userData: string;
  let settingsFile: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  const launch = async (): Promise<void> => {
    app = await _electron.launch({
      args: ['.', `--user-data-dir=${userData}`],
      cwd: join(here, '..'),
      env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
    });
    page = await firstWindow(app);
    await page.waitForSelector('#editor .cm-content');
    await page.waitForSelector('tyto-status-bar .status-bar__button');
    // The theme rides on the same answer as `vimMode`: once it is applied, so is the setting.
    await page.waitForFunction(
      (expected) => getComputedStyle(document.body).backgroundColor === expected,
      lightSurface(),
      { polling: 25, timeout: 15_000 },
    );
  };

  const quit = async (): Promise<void> => {
    if (app !== undefined) await closeApp(app);
    app = undefined;
  };

  const badgeShown = (): Promise<boolean> =>
    page.evaluate((selector) => document.querySelector(selector) !== null, BADGE);

  const toggleVim = async (): Promise<void> => {
    await page.click('#editor .cm-content');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('editor.toggleVim');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
  };

  /** The value the file holds for the key, or `undefined` when it does not name it. */
  const vimModeInFile = (): boolean | undefined => {
    const found = /"vimMode"\s*:\s*(true|false)/u.exec(readFileSync(settingsFile, 'utf8'));
    return found === null ? undefined : found[1] === 'true';
  };

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'tyto-vim-setting-'));
    userData = join(scratch, 'user-data');
    mkdirSync(userData, { recursive: true });
    settingsFile = join(userData, 'settings.json');
    writeFileSync(settingsFile, '{\n  // written before launch\n  "theme": "tyto-light"\n}\n');
  });

  afterAll(async () => {
    await quit();
    rmSync(scratch, { recursive: true, force: true });
  });

  it('opens with vim off when the file does not name it', async () => {
    await launch();
    expect(await badgeShown()).toBe(false);
  });

  it('writes the setting when the command turns vim on', async () => {
    await toggleVim();
    await page.waitForSelector(BADGE);
    await expect.poll(vimModeInFile, { timeout: 5_000 }).toBe(true);
    // In place: the comment the person wrote is still there.
    expect(readFileSync(settingsFile, 'utf8')).toContain('// written before launch');
  });

  it('opens with vim on after a restart', async () => {
    await quit();
    await launch();
    await page.waitForSelector(BADGE, { timeout: 5_000 });
    expect(await badgeShown()).toBe(true);
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, 'vim-on-after-relaunch.png') });
    }
  });

  it('opens with vim off after the command turned it off and the app restarted', async () => {
    await toggleVim();
    await page.waitForSelector(BADGE, { state: 'detached' });
    // Off is the default, so the store removes the key rather than writing `false`.
    await expect.poll(vimModeInFile, { timeout: 5_000 }).toBeUndefined();
    await quit();
    await launch();
    expect(await badgeShown()).toBe(false);
  });

  it('turns vim on and off in an open window when the file is edited by hand', async () => {
    writeFileSync(settingsFile, '{\n  "theme": "tyto-light",\n  "vimMode": true\n}\n');
    await page.waitForSelector(BADGE, { timeout: 10_000 });
    writeFileSync(settingsFile, '{\n  "theme": "tyto-light",\n  "vimMode": false\n}\n');
    await page.waitForSelector(BADGE, { state: 'detached', timeout: 10_000 });
  });
});
