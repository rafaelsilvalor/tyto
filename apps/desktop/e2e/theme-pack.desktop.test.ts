import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The theme pack, through the real window (TYTO-300, ADR 0089).
 *
 * `@tyto/theme-pack` is a built-in plugin, so its themes are in the picker of a fresh install
 * with nothing installed. The suite picks a dark one and a light one from Ctrl+K and watches
 * `--tyto-surface` take the pack's value — which proves main read the file through the pack's
 * own reader, since a theme it could not read falls back to Tyto Light or Tyto Dark whole.
 *
 * With `TYTO_THEME_PACK_SHOTS` set to a folder, the suite also leaves a screenshot of each
 * theme with a brief in the editor, its preview to the side and the problems panel open, at
 * 900x600 and at the window's default size.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

/** Each theme's `surface`, as the file writes it and as `getComputedStyle` reports the body. */
const THEMES = [
  { label: 'Dracula', filter: 'dracula', surface: '#282a36', body: 'rgb(40, 42, 54)' },
  {
    label: 'Catppuccin Latte',
    filter: 'catppuccin latte',
    surface: '#eff1f5',
    body: 'rgb(239, 241, 245)',
  },
] as const;

/** A brief with art to preview and one line the problems panel lists. */
const BRIEF = '---\ntemplate: promo-curso\n---\n::titulo Tema novo\n::nao-existe linha\n';

const shots = process.env['TYTO_THEME_PACK_SHOTS'];

let scratch: string;
let app: ElectronApplication;
let page: Page;
let defaultSize: readonly [number, number];

const setContentSize = (width: number, height: number): Promise<void> =>
  app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(w, h);
    },
    [width, height] as const,
  );

const surfaceToken = (): Promise<string> =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--tyto-surface').trim(),
  );

/** Waits for the body to take a colour: a theme answer and a media query land on a frame. */
async function waitForBody(colour: string): Promise<void> {
  await page.waitForFunction(
    (expected) => getComputedStyle(document.body).backgroundColor === expected,
    colour,
    { polling: 25, timeout: 15_000 },
  );
}

/** Ctrl+K, the command, Enter, and the picker's rows once the pack's themes are among them. */
async function openPicker(): Promise<string[]> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type('theme.pick');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.command-bar__label')].some(
        (label) => label.textContent === 'Dracula',
      ),
    undefined,
    { timeout: 30_000 },
  );
  return page.evaluate(() =>
    [...document.querySelectorAll('.command-bar__label')].map((label) => label.textContent ?? ''),
  );
}

async function choose(theme: (typeof THEMES)[number]): Promise<void> {
  await openPicker();
  await page.keyboard.type(theme.filter);
  await waitForBody(theme.body);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.command-bar__input', { state: 'hidden' });
  await waitForBody(theme.body);
}

async function runFromBar(id: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

beforeAll(async () => {
  // Its own data folders, never the machine's (TYTO-139).
  scratch = mkdtempSync(join(tmpdir(), 'tyto-theme-pack-e2e-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  defaultSize = await app.evaluate(({ BrowserWindow }) => {
    const [width, height] = BrowserWindow.getAllWindows()[0]?.getContentSize() ?? [0, 0];
    return [width ?? 0, height ?? 0] as const;
  });
  await setContentSize(900, 600);
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the theme pack', () => {
  it('lists its themes in the picker of an install with no plugins', async () => {
    const labels = await openPicker();
    expect(labels).toEqual(
      expect.arrayContaining(['Tyto Light', 'Tyto Dark', 'Dracula', 'Catppuccin Latte']),
    );
    await page.keyboard.press('Escape');
  }, 60_000);

  it.each(THEMES)(
    'applies $label with its own surface, not the base theme’s',
    async (theme) => {
      await choose(theme);
      expect(await surfaceToken()).toBe(theme.surface);
    },
    60_000,
  );

  it.runIf(shots !== undefined)(
    'leaves a screenshot of each theme with a brief, its preview and the problems',
    async () => {
      const folder = shots!;
      mkdirSync(folder, { recursive: true });
      await page.click('#editor .cm-content');
      await page.keyboard.insertText(BRIEF);
      await runFromBar('preview.openToSide');
      // Open by default; toggled only when a saved layout closed it.
      const open = await page.evaluate(
        () => document.querySelector('[data-panel="problems"]') !== null,
      );
      if (!open) await runFromBar('layout.togglePanel:problems');
      await page.waitForSelector('[data-panel="problems"]');
      for (const theme of THEMES) {
        await choose(theme);
        await page.waitForTimeout(1500);
        await page.screenshot({
          path: join(folder, `${theme.filter.replace(' ', '-')}-900x600.png`),
        });
        await setContentSize(defaultSize[0], defaultSize[1]);
        await page.waitForTimeout(1500);
        await page.screenshot({
          path: join(folder, `${theme.filter.replace(' ', '-')}-${defaultSize.join('x')}.png`),
        });
        await setContentSize(900, 600);
      }
    },
    120_000,
  );
});
